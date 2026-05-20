const { typedError } = require("../errors");
const localRest = require("../adapters/local-rest");
const { findTask, getTasksBySource, startOfTodayMs, valueOf } = require("./task-common");

async function taskUpdate(payload) {
  if (!payload.taskId) {
    throw typedError("INVALID_REQUEST", "taskId is required", false);
  }
  const updates = { ...payload };
  delete updates.taskId;
  await PluginAPI.updateTask(payload.taskId, updates);
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

  if (await localRest.archiveTask(taskId)) {
    return { archived: true, via: "localRest" };
  }

  if (valueOf(payload || {}, "allowDoneFallback", "allow_done_fallback") === true) {
    await PluginAPI.updateTask(taskId, { isDone: true, doneOn: Date.now() });
    return { archived: false, note: "Local REST archive unavailable; explicit allowDoneFallback marked task done instead" };
  }

  throw typedError(
    "UNSUPPORTED_ACTION",
    "True archive requires SP_LOCAL_REST_URL or SUPER_PRODUCTIVITY_REST_URL. Pass allowDoneFallback:true only if marking done is acceptable.",
    false,
  );
}

async function taskRestore(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  await localRest.restoreTask(taskId);
  return { restored: true, via: "localRest" };
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

async function taskAddTime(payload) {
  const task = await findTask(payload.taskId);
  if (!task) {
    throw typedError("TASK_NOT_FOUND", `Task ${payload.taskId} not found`, false);
  }
  const add = Number(payload.timeMs || 0);
  await PluginAPI.updateTask(payload.taskId, { timeSpent: (task.timeSpent || 0) + add });
  return { timeSpent: (task.timeSpent || 0) + add };
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

async function taskStart(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  if (await localRest.startTask(taskId)) {
    return { started: true, via: "localRest" };
  }
  const tasks = await PluginAPI.getTasks();
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (task.isDone) throw typedError("TASK_DONE", `Cannot start completed task ${taskId}`, false);
  const active = tasks.find((candidate) => candidate.currentTimestamp > 0 && candidate.id !== taskId);
  if (active) await PluginAPI.updateTask(active.id, { currentTimestamp: null });
  await PluginAPI.updateTask(taskId, { currentTimestamp: Date.now() });
  return { started: true };
}

async function taskStop() {
  if (await localRest.stopCurrentTask()) {
    return { stopped: true, via: "localRest" };
  }
  const tasks = await PluginAPI.getTasks();
  const active = tasks.find((task) => task.currentTimestamp > 0);
  if (!active) return { stopped: false };
  await PluginAPI.updateTask(active.id, { currentTimestamp: null });
  return { stopped: true };
}

async function taskCurrent() {
  const restCurrent = await localRest.getCurrentTask();
  if (restCurrent.configured) {
    return { task: restCurrent.task, via: "localRest" };
  }
  const tasks = await PluginAPI.getTasks();
  const active = tasks.find((task) => task.currentTimestamp > 0);
  if (!active) return { task: null };
  return {
    task: {
      id: active.id,
      title: active.title,
      isDone: active.isDone,
      projectId: active.projectId,
      parentId: active.parentId,
      tagIds: active.tagIds,
      dueDay: active.dueDay,
    },
  };
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
  const existingTasks = dryRun || allowedFields ? await getTasksBySource("all") : [];
  const results = [];
  for (const item of updates) {
    const taskId = valueOf(item, "taskId", "task_id");
    try {
      if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
      const fullPatch = mapTaskUpdate(item);
      const patch = pickAllowedPatch(fullPatch, allowedFields);
      if (Object.keys(patch).length === 0) {
        throw typedError("NO_UPDATE_FIELDS", allowedFields ? `No allowed fields provided: ${allowedFields.join(", ")}` : "No update fields provided", false);
      }
      const task = existingTasks.find((candidate) => candidate.id === taskId) || null;
      if ((dryRun || allowedFields) && !task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
      const result = { id: taskId, success: true };
      const changes = diffTaskPatch(task, patch);
      if (changes.length) result.changes = changes;
      const ignoredFields = ignoredPatchFields(fullPatch, patch);
      if (ignoredFields.length) result.ignoredFields = ignoredFields;
      if (!dryRun) await PluginAPI.updateTask(taskId, patch);
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
  return taskBulkUpdateCore(payload || {}, ["plannedAt", "dueDay", "timeEstimate"]);
}

async function taskWorklog(payload) {
  const startDate = valueOf(payload || {}, "startDate", "start_date");
  const endDate = valueOf(payload || {}, "endDate", "end_date") || startDate;
  const tasks = await PluginAPI.getTasks();
  const entries = [];
  for (const task of tasks) {
    for (const entry of normalizeWorklogEntries(task)) {
      if (startDate && entry.date < startDate) continue;
      if (endDate && entry.date > endDate) continue;
      entries.push({
        date: entry.date,
        taskId: task.id,
        title: task.title,
        projectId: task.projectId,
        tagIds: task.tagIds || [],
        timeMs: entry.timeMs,
      });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || String(a.title || "").localeCompare(String(b.title || "")));
  return { entries, totalMs: entries.reduce((sum, entry) => sum + entry.timeMs, 0) };
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

async function taskPlanToday(payload) {
  const taskIds = valueOf(payload || {}, "taskIds", "task_ids") || [];
  const plannedAt = payload?.unplan ? null : startOfTodayMs();
  return taskBulkUpdate({ updates: taskIds.map((taskId) => ({ taskId, plannedAt })) });
}

const exported = {
  taskAddTime,
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

module.exports = exported;
