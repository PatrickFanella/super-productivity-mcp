const { typedError } = require("../errors");
const { findTask, getDayContext, getTasksBySource, isLocalDateString, valueOf } = require("./task-common");
const { clearPatch, dayOnlyPatch, hasScheduleInput, scheduleWrite } = require("./task-schedule-write");
const { scheduleDayIn, taskSchedule } = require("./task-shape");

const ARCHIVE_UNAVAILABLE_MESSAGE =
  "True archive needs Local REST: set SP_LOCAL_REST_URL (stock v20: http://127.0.0.1:3876) and SP_LOCAL_REST_TOKEN for the MCP server. Pass allowDoneFallback:true only if marking the task done is acceptable.";
const RESTORE_UNAVAILABLE_MESSAGE =
  "Restore needs Local REST: set SP_LOCAL_REST_URL (stock v20: http://127.0.0.1:3876) and SP_LOCAL_REST_TOKEN for the MCP server. There is no plugin fallback.";
const ARCHIVE_FALLBACK_NOTE = "Local REST is not configured; explicit allowDoneFallback marked the task done instead of archiving it";

async function taskUpdate(payload) {
  if (!payload.taskId) {
    throw typedError("INVALID_REQUEST", "taskId is required", false);
  }
  if (["deadlineDay", "deadlineWithTime", "deadlineRemindAt"].some((key) => key in payload)) {
    // The MCP server sends deadline edits to Local REST; a plain plugin update
    // would skip the app's deadline planning.
    throw typedError("UNSUPPORTED_ACTION", "Deadlines need Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN). Nothing was changed.", false);
  }
  const updates = { ...payload };
  delete updates.taskId;
  const input = {};
  for (const key of ["dueDay", "dueWithTime", "plannedAt"]) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      input[key] = updates[key];
      delete updates[key];
    }
  }
  if (hasScheduleInput(input)) {
    // Read the task fresh: the canonical write depends on its current schedule.
    const task = await findTask(payload.taskId);
    if (!task) throw typedError("TASK_NOT_FOUND", `Task ${payload.taskId} not found`, false);
    Object.assign(updates, scheduleWrite(input, task));
  }
  if (Object.keys(updates).length === 0) throw typedError("NO_UPDATE_FIELDS", "No update fields provided", false);
  // Titles are data from the caller: never let the app parse them as short syntax.
  await PluginAPI.updateTask(payload.taskId, updates, { isIgnoreShortSyntax: true });
  return { updated: true };
}

async function taskComplete(payload) {
  await PluginAPI.updateTask(payload.taskId, { isDone: true, doneOn: Date.now() });
  return { completed: true };
}

async function taskUncomplete(payload) {
  await PluginAPI.updateTask(payload.taskId, { isDone: false, doneOn: null });
  return { uncompleted: true };
}

async function taskArchive(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);

  // The MCP server sends true archive to Local REST itself when it is
  // configured; a request reaching the plugin means REST is not configured.
  if (valueOf(payload || {}, "allowDoneFallback", "allow_done_fallback") === true) {
    await PluginAPI.updateTask(taskId, { isDone: true, doneOn: Date.now() });
    return { archived: false, note: ARCHIVE_FALLBACK_NOTE };
  }

  throw typedError("UNSUPPORTED_ACTION", ARCHIVE_UNAVAILABLE_MESSAGE, false);
}

async function taskRestore(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  // The MCP server restores through Local REST itself when it is configured;
  // the plugin API has no restore, so there is no fallback here.
  throw typedError("UNSUPPORTED_ACTION", RESTORE_UNAVAILABLE_MESSAGE, false);
}

async function taskDelete(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (typeof PluginAPI.deleteTask !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "deleteTask not supported by this plugin runtime", false);
  }
  await PluginAPI.deleteTask(taskId);
  return { deleted: true };
}

// Time logging goes through Local REST (POST/PUT /tasks/:id/time), which the
// MCP server calls itself. The plugin API has no supported per-day time
// write: patching timeSpent leaves timeSpentOnDay unchanged and the app
// recalculates over it, so the plugin refuses instead of writing.
const TIME_LOGGING_UNAVAILABLE =
  "Logging time needs Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN): the plugin API cannot update a day's time record. Nothing was changed.";

async function taskAddTime() {
  throw typedError("UNSUPPORTED_ACTION", TIME_LOGGING_UNAVAILABLE, false);
}

async function taskSetTimeForDay() {
  throw typedError("UNSUPPORTED_ACTION", TIME_LOGGING_UNAVAILABLE, false);
}

async function validateReorderContext(taskIds, contextId, contextType) {
  if (!contextId || taskIds.length === 0) return;
  const tasks = await PluginAPI.getTasks();
  for (const taskId of taskIds) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
    let belongs = false;
    if (contextType === "parent") belongs = task.parentId === contextId;
    else if (contextType === "tag") belongs = Array.isArray(task.tagIds) && task.tagIds.includes(contextId);
    else belongs = task.projectId === contextId;
    if (!belongs) {
      throw typedError("TASK_CONTEXT_MISMATCH", `Task ${taskId} does not belong to context ${contextId}`, false, { taskId, contextId, contextType });
    }
  }
}

async function taskReorder(payload) {
  if (typeof PluginAPI.reorderTasks !== "function") {
    return { reordered: false, note: "reorderTasks not supported by this plugin runtime" };
  }
  const taskIds = valueOf(payload || {}, "taskIds", "task_ids") || [];
  const contextId = valueOf(payload || {}, "contextId", "context_id");
  const contextType = valueOf(payload || {}, "contextType", "context_type") || "project";
  await validateReorderContext(taskIds, contextId, contextType);
  const apiContextType = contextType === "parent" ? "task" : contextType;
  await PluginAPI.reorderTasks(taskIds, contextId, apiContextType);
  return { reordered: true };
}

// Tracking without Local REST uses PluginAPI.startTracking/stopTracking,
// which v20 offers; when REST is configured the MCP server calls
// /task-control itself. No handler writes currentTimestamp: v20 ignores it.
const TRACKING_UNAVAILABLE =
  "this Super Productivity runtime lacks PluginAPI.startTracking/stopTracking; configure Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN) instead";

async function taskStart(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  if (typeof PluginAPI.startTracking !== "function") throw typedError("UNSUPPORTED_ACTION", `Starting a task: ${TRACKING_UNAVAILABLE}`, false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (task.isDone) throw typedError("TASK_DONE", `Cannot start completed task ${taskId}; mark it not done first`, false);
  // startTracking tracks a parent's first unfinished subtask, and rejects a
  // parent whose subtasks are all done.
  await PluginAPI.startTracking(taskId);
  return { started: true, via: "plugin" };
}

async function taskStop() {
  if (typeof PluginAPI.stopTracking !== "function") throw typedError("UNSUPPORTED_ACTION", `Stopping tracking: ${TRACKING_UNAVAILABLE}`, false);
  await PluginAPI.stopTracking();
  return { stopped: true, via: "plugin" };
}

async function taskCurrent() {
  // The v20 plugin API has no current-task read; Local REST /status does.
  throw typedError(
    "UNSUPPORTED_ACTION",
    "Reading the tracked task needs Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN); the plugin API has no current-task read",
    false,
  );
}

async function taskBulkComplete(payload) {
  const taskIds = valueOf(payload || {}, "taskIds", "task_ids") || [];
  const tasks = await PluginAPI.getTasks();
  const results = [];
  for (const id of taskIds) {
    if (!tasks.find((task) => task.id === id)) {
      results.push({ id, success: false, error: `Task not found: ${id}` });
      continue;
    }
    try {
      await PluginAPI.updateTask(id, { isDone: true, doneOn: Date.now() });
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err.message || String(err) });
    }
  }
  return { results };
}

async function taskBulkUpdate(payload) {
  return taskBulkUpdateCore(payload || {}, null);
}

async function taskBulkUpdateCore(payload, allowedFields) {
  const updates = payload?.updates || [];
  const dryRun = valueOf(payload || {}, "dryRun", "dry_run") === true;
  const needsTasks = dryRun || allowedFields || updates.some((item) => hasScheduleInput(mapTaskUpdate(item)));
  const existingTasks = needsTasks ? await getTasksBySource("all") : [];
  const results = [];
  for (const item of updates) {
    const taskId = valueOf(item, "taskId", "task_id");
    try {
      if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
      const fullPatch = mapTaskUpdate(item);
      const picked = pickAllowedPatch(fullPatch, allowedFields);
      if (Object.keys(picked).length === 0) {
        throw typedError("NO_UPDATE_FIELDS", allowedFields ? `No allowed fields provided: ${allowedFields.join(", ")}` : "No update fields provided", false);
      }
      const task = existingTasks.find((candidate) => candidate.id === taskId) || null;
      if ((needsTasks || allowedFields) && !task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
      // Schedule inputs become the canonical v20 fields; the diff shows them.
      const patch = { ...picked };
      const scheduleInput = {};
      for (const key of ["dueDay", "dueWithTime", "plannedAt"]) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          scheduleInput[key] = patch[key];
          delete patch[key];
        }
      }
      Object.assign(patch, scheduleWrite(scheduleInput, task));
      const result = { id: taskId, success: true };
      const changes = diffTaskPatch(task, patch);
      if (changes.length) result.changes = changes;
      const ignoredFields = ignoredPatchFields(fullPatch, picked);
      if (ignoredFields.length) result.ignoredFields = ignoredFields;
      if (!dryRun) await PluginAPI.updateTask(taskId, patch, { isIgnoreShortSyntax: true });
      results.push(result);
    } catch (err) {
      results.push({ id: taskId, success: false, error: err.message || String(err) });
    }
  }
  return { dryRun, results };
}

function pickAllowedPatch(patch, allowedFields) {
  if (!allowedFields) return patch;
  const allowed = new Set(allowedFields);
  return Object.fromEntries(Object.entries(patch).filter(([field]) => allowed.has(field)));
}

function ignoredPatchFields(fullPatch, patch) {
  const included = new Set(Object.keys(patch));
  return Object.keys(fullPatch).filter((field) => !included.has(field));
}

function diffTaskPatch(task, patch) {
  return Object.entries(patch).map(([field, after]) => ({
    field,
    before: task ? task[field] : undefined,
    after,
  }));
}

async function taskBulkReschedule(payload) {
  return taskBulkUpdateCore(payload || {}, ["dueWithTime", "plannedAt", "dueDay", "timeEstimate"]);
}

// applyPatches writes already-canonical patches ({taskId, patch}) with the
// bulk result shape, or only reports them in a dry run.
async function applyPatches(entries, tasksById, dryRun) {
  const results = [];
  for (const { taskId, patch, note } of entries) {
    const task = tasksById.get(taskId) || null;
    try {
      if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
      const result = { id: taskId, success: true };
      if (note) result.note = note;
      const changes = diffTaskPatch(task, patch);
      if (changes.length) result.changes = changes;
      if (!dryRun && changes.length) await PluginAPI.updateTask(taskId, patch);
      results.push(result);
    } catch (err) {
      results.push({ id: taskId, success: false, error: err.message || String(err) });
    }
  }
  return { dryRun, results };
}

// taskWorklog reports per-day time from leaf tasks only: Super Productivity
// rolls subtask time up into the parent's timeSpentOnDay, so counting parents
// too would count the same work twice. Totals come from the per-day records
// in range, never from a task's aggregate timeSpent.
async function taskWorklog(payload) {
  payload = payload || {};
  const startDate = valueOf(payload, "startDate", "start_date");
  const endDate = valueOf(payload, "endDate", "end_date") || startDate;
  for (const [name, value] of [["startDate", startDate], ["endDate", endDate]]) {
    if (value != null && !isLocalDateString(value)) throw typedError("INVALID_REQUEST", `${name} must be YYYY-MM-DD`, false);
  }
  if (startDate && endDate && endDate < startDate) throw typedError("INVALID_REQUEST", "endDate must not be before startDate", false);
  const projectId = valueOf(payload, "projectId", "project_id");
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;

  const tasks = (await PluginAPI.getTasks()).map((task) => ({ ...task, isArchived: false }));
  const coverage = { activeIncluded: true, archivedIncluded: false, complete: false, reason: "archived tasks not requested; pass includeArchived:true" };
  if (includeArchived) {
    if (typeof PluginAPI.getArchivedTasks === "function") {
      tasks.push(...(await PluginAPI.getArchivedTasks()).map((task) => ({ ...task, isArchived: true })));
      coverage.archivedIncluded = true;
      coverage.complete = true;
      delete coverage.reason;
    } else {
      coverage.reason = "this Super Productivity runtime cannot read archived tasks";
    }
  }

  const parentIds = new Set(tasks.filter((task) => task.parentId).map((task) => task.parentId));
  const entries = [];
  for (const task of tasks) {
    if (parentIds.has(task.id) || (Array.isArray(task.subTaskIds) && task.subTaskIds.length > 0)) continue;
    if (projectId && task.projectId !== projectId) continue;
    for (const entry of normalizeWorklogEntries(task)) {
      if (startDate && entry.date < startDate) continue;
      if (endDate && entry.date > endDate) continue;
      entries.push({
        date: entry.date,
        taskId: task.id,
        title: task.title,
        projectId: task.projectId,
        parentId: task.parentId || null,
        tagIds: task.tagIds || [],
        isArchived: task.isArchived,
        timeMs: entry.timeMs,
      });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || String(a.title || "").localeCompare(String(b.title || "")) || a.taskId.localeCompare(b.taskId));
  return { entries, totalMs: entries.reduce((sum, entry) => sum + entry.timeMs, 0), coverage };
}

function normalizeWorklogEntries(task) {
  const raw = task.timeSpentOnDay || task.timeSpentByDay || task.timeSpentOnDayMap;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => ({ date: entry.date || entry.day, timeMs: Number(entry.timeMs ?? entry.timeSpent ?? entry.duration ?? 0) }))
      .filter((entry) => entry.date && entry.timeMs > 0);
  }
  return Object.entries(raw)
    .map(([date, timeMs]) => ({ date, timeMs: Number(timeMs || 0) }))
    .filter((entry) => entry.date && entry.timeMs > 0);
}

function mapTaskUpdate(item) {
  const data = {};
  const mappings = [
    ["title", "title"],
    ["notes", "notes"],
    ["isDone", "is_done"],
    ["dueDay", "due_day"],
    ["dueWithTime", "due_with_time"],
    ["plannedAt", "planned_at"],
    ["timeEstimate", "time_estimate"],
    ["timeSpent", "time_spent"],
    ["tagIds", "tag_ids"],
    ["projectId", "project_id"],
  ];
  for (const [camelName, snakeName] of mappings) {
    const value = valueOf(item, camelName, snakeName);
    if (value !== undefined) data[camelName] = camelName === "dueDay" && value === "" ? null : value;
  }
  if (typeof data.isDone === "boolean") data.doneOn = data.isDone ? Date.now() : null;
  return data;
}

// taskPlanToday files tasks under the app's logical Today as day-only work,
// as "Add to Today" does: it never invents a time. A task already timed on
// that day keeps its time. unplan removes the whole schedule.
async function taskPlanToday(payload) {
  const taskIds = valueOf(payload || {}, "taskIds", "task_ids") || [];
  const tasksById = new Map((await getTasksBySource("active")).map((task) => [task.id, task]));
  const day = payload?.unplan ? null : await getDayContext();
  const entries = taskIds.map((taskId) => {
    const task = tasksById.get(taskId);
    if (!day) return { taskId, patch: clearPatch(task) };
    const schedule = task ? taskSchedule(task) : null;
    if (schedule && schedule.kind === "timed" && scheduleDayIn(schedule, day.startOfNextDayDiffMs) === day.todayStr) {
      return { taskId, patch: {}, note: "already scheduled with a time today" };
    }
    return { taskId, patch: dayOnlyPatch(task, day.todayStr) };
  });
  const out = await applyPatches(entries, tasksById, false);
  if (day) out.dayContext = day;
  return out;
}

const exported = {
  taskAddTime,
  taskSetTimeForDay,
  taskArchive,
  taskComplete,
  taskBulkComplete,
  taskBulkReschedule,
  taskBulkUpdate,
  taskCurrent,
  taskDelete,
  taskPlanToday,
  taskReorder,
  taskRestore,
  taskStart,
  taskStop,
  taskUncomplete,
  taskUpdate,
  taskWorklog,
};

Object.defineProperty(exported, "taskBulkUpdateCore", { value: taskBulkUpdateCore, enumerable: false });
Object.defineProperty(exported, "applyPatches", { value: applyPatches, enumerable: false });

module.exports = exported;
