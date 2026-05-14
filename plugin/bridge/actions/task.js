const { typedError } = require("../errors");

async function findTask(taskId) {
  const tasks = await PluginAPI.getTasks();
  return tasks.find((t) => t.id === taskId) || null;
}

async function taskCreate(payload) {
  const data = await buildTaskData(payload);
  const taskId = await PluginAPI.addTask(data);
  return { taskId };
}

async function buildTaskData(payload) {
  const parsed = await parseTaskShortSyntax(payload.title || "");
  const data = {
    title: parsed.title,
    notes: payload.notes || "",
    projectId: valueOf(payload, "projectId", "project_id") || parsed.projectId,
    parentId: valueOf(payload, "parentId", "parent_id"),
    timeEstimate: valueOf(payload, "timeEstimate", "time_estimate") ?? parsed.timeEstimate ?? 0,
    tagIds: mergeUnique(valueOf(payload, "tagIds", "tag_ids") || [], parsed.tagIds),
  };
  if (parsed.timeSpent != null) data.timeSpent = parsed.timeSpent;
  if (parsed.dueDay != null) data.dueDay = parsed.dueDay;
  if (parsed.dueWithTime != null) data.dueWithTime = parsed.dueWithTime;
  return data;
}

async function taskCreateWithSubtasks(payload) {
  if (!Array.isArray(payload?.subtasks)) {
    throw typedError("INVALID_REQUEST", "subtasks must be an array", false);
  }
  const parentData = await buildTaskData(payload);
  const parentId = await PluginAPI.addTask(parentData);
  const subtaskIds = [];
  for (const subtask of payload.subtasks) {
    const childData = await buildTaskData({ ...subtask, parentId });
    const childId = await PluginAPI.addTask(childData);
    subtaskIds.push(childId);
  }
  return { parentId, subtaskIds };
}


async function parseTaskShortSyntax(title) {
  const parsed = { title: title || "", tagIds: [] };
  const remove = [];

  for (const match of title.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    const tag = await findTagByTitle(match[1]);
    if (tag?.id) parsed.tagIds.push(tag.id);
    remove.push(match[0]);
  }

  for (const match of title.matchAll(/\+([\p{L}\p{N}_-]{3,})/gu)) {
    const project = await findProjectByPrefix(match[1]);
    if (project?.id && !parsed.projectId) parsed.projectId = project.id;
    remove.push(match[0]);
  }

  const due = parseDueSyntax(title);
  if (due) {
    parsed.dueDay = due.dueDay;
    if (due.dueWithTime != null) parsed.dueWithTime = due.dueWithTime;
    remove.push(due.token);
    if (due.timeToken) remove.push(due.timeToken);
  }

  const estimate = parseTimeSyntax(title);
  if (estimate) {
    if (estimate.timeSpent != null) parsed.timeSpent = estimate.timeSpent;
    if (estimate.timeEstimate != null) parsed.timeEstimate = estimate.timeEstimate;
    remove.push(estimate.token);
  }

  parsed.title = stripTokens(title, remove) || title;
  return parsed;
}

async function findTagByTitle(title) {
  if (typeof PluginAPI.getAllTags !== "function") return null;
  const tags = await PluginAPI.getAllTags();
  const needle = title.toLowerCase();
  return tags.find((tag) => String(tag.title || tag.name || "").toLowerCase() === needle) || null;
}

async function findProjectByPrefix(prefix) {
  if (typeof PluginAPI.getAllProjects !== "function") return null;
  const projects = await PluginAPI.getAllProjects();
  const needle = prefix.toLowerCase();
  return projects.find((project) => String(project.title || project.name || "").toLowerCase().startsWith(needle)) || null;
}

function parseDueSyntax(title) {
  const match = title.match(/@(today|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s+((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?|(?:1[0-2]|0?\d)\s*(?:am|pm)))?/i);
  if (!match) return null;
  const date = resolveDueDate(match[1]);
  const out = { token: match[0], dueDay: localDateStr(date), timeToken: match[2] };
  const time = parseClockTime(match[2]);
  if (time) out.dueWithTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute).getTime();
  return out;
}

function resolveDueDate(word) {
  const normalized = word.toLowerCase().slice(0, 3);
  const date = new Date();
  if (normalized === "tom") {
    date.setDate(date.getDate() + 1);
    return date;
  }
  if (normalized === "tod") return date;
  const weekdays = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  if (weekdays[normalized] !== undefined) {
    let diff = weekdays[normalized] - date.getDay();
    if (diff <= 0) diff += 7;
    date.setDate(date.getDate() + diff);
  }
  return date;
}

function parseClockTime(raw) {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridian = match[3]?.toLowerCase();
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function parseTimeSyntax(title) {
  const match = title.match(/\b(\d+(?:\.\d+)?)([hm])(?:\/(\d+(?:\.\d+)?)([hm]))?\b/i);
  if (!match) return null;
  const first = durationMs(match[1], match[2]);
  const second = match[3] ? durationMs(match[3], match[4]) : null;
  return second == null ? { token: match[0], timeEstimate: first } : { token: match[0], timeSpent: first, timeEstimate: second };
}

function durationMs(amount, unit) {
  const multiplier = unit.toLowerCase() === "h" ? 60 * 60 * 1000 : 60 * 1000;
  return Math.round(Number(amount) * multiplier);
}

function stripTokens(title, tokens) {
  let out = title;
  for (const token of tokens.filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.replace(token, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function mergeUnique(first, second) {
  return [...new Set([...(first || []), ...(second || [])])];
}

async function taskList(payload) {
  payload = payload || {};
  const includeDone = payload?.includeDone !== false;
  let tasks = await getTasksBySource(payload.source || "active");
  if (!includeDone) {
    tasks = tasks.filter((t) => !t.isDone);
  }
  const projectId = valueOf(payload, "projectId", "project_id");
  if (projectId) {
    tasks = tasks.filter((t) => t.projectId === projectId);
  }
  const tagId = valueOf(payload, "tagId", "tag_id");
  if (tagId) {
    tasks = tasks.filter((t) => Array.isArray(t.tagIds) && t.tagIds.includes(tagId));
  }
  const isDone = valueOf(payload, "isDone", "is_done");
  if (typeof isDone === "boolean") {
    tasks = tasks.filter((t) => !!t.isDone === isDone);
  }
  const isArchived = valueOf(payload, "isArchived", "is_archived");
  if (typeof isArchived === "boolean") {
    tasks = tasks.filter((t) => !!t.isArchived === isArchived);
  }
  const search = String(payload.search || "").trim().toLowerCase();
  if (search) {
    tasks = tasks.filter((t) => `${t.title || ""}\n${t.notes || ""}`.toLowerCase().includes(search));
  }
  if (valueOf(payload, "parentsOnly", "parents_only")) {
    tasks = tasks.filter((t) => !t.parentId);
  }
  if (payload?.overdue) {
    const today = localDateStr(new Date());
    tasks = tasks.filter((t) => t.dueDay != null && t.dueDay < today);
  }
  if (payload?.unscheduled) {
    tasks = tasks.filter((t) => !t.dueDay && !t.dueWithTime);
  }
  if (payload?.plannedForToday) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 86400000;
    tasks = tasks.filter((t) => t.plannedAt != null && t.plannedAt >= start && t.plannedAt < end);
  }
  if (valueOf(payload, "recurringOnly", "recurring_only")) {
    tasks = tasks.filter((t) => !!(t.repeatCfgId || t.recurrenceRule || t.repeatCycle));
  }
  if (valueOf(payload, "includeSynthetic", "include_synthetic")) {
    tasks = await withSyntheticTaskFields(tasks);
  }
  tasks = sortAndPageTasks(tasks, payload);
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  if (fields.length > 0) {
    tasks = tasks.map((task) => pickFields(task, fields));
  }
  return { tasks };
}

async function withSyntheticTaskFields(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const projects = typeof PluginAPI.getAllProjects === "function" ? await PluginAPI.getAllProjects() : [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return tasks.map((task) => ({
    ...task,
    noteLength: String(task.notes || "").length,
    subtaskCount: Array.isArray(task.subTaskIds) ? task.subTaskIds.length : tasks.filter((candidate) => candidate.parentId === task.id).length,
    isRecurring: !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle),
    parentTitle: task.parentId ? byId.get(task.parentId)?.title : undefined,
    projectTitle: task.projectId ? projectById.get(task.projectId)?.title || projectById.get(task.projectId)?.name : undefined,
  }));
}

function sortAndPageTasks(tasks, payload) {
  const sortBy = valueOf(payload || {}, "sortBy", "sort_by");
  let out = [...tasks];
  if (["title", "created", "updated", "dueDay", "plannedAt", "timeEstimate"].includes(sortBy)) {
    const direction = valueOf(payload || {}, "sortDirection", "sort_direction") === "desc" ? -1 : 1;
    out.sort((a, b) => compareTaskField(a, b, sortBy) * direction);
  }
  const offset = Math.max(0, Number(valueOf(payload || {}, "offset", "offset") || 0));
  const limitValue = valueOf(payload || {}, "limit", "limit");
  if (offset > 0) out = out.slice(offset);
  if (limitValue != null) out = out.slice(0, Math.max(0, Number(limitValue)));
  return out;
}

function compareTaskField(a, b, field) {
  const av = a[field];
  const bv = b[field];
  if (av == null && bv == null) return String(a.title || "").localeCompare(String(b.title || ""));
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" || typeof bv === "number") return Number(av) - Number(bv);
  return String(av).localeCompare(String(bv)) || String(a.title || "").localeCompare(String(b.title || ""));
}

async function getTasksBySource(source) {
  const normalized = ["active", "archived", "all"].includes(source) ? source : "active";
  const active = (await PluginAPI.getTasks()).map((task) => ({
    ...task,
    isArchived: task.isArchived ?? false,
  }));
  if (normalized === "active") return active;
  if (typeof PluginAPI.getArchivedTasks !== "function") {
    return normalized === "archived" ? [] : active;
  }
  const archived = (await PluginAPI.getArchivedTasks()).map((task) => ({
    ...task,
    isArchived: true,
  }));
  return normalized === "archived" ? archived : [...active, ...archived];
}

function valueOf(obj, camelName, snakeName) {
  if (obj[camelName] !== undefined) return obj[camelName];
  return obj[snakeName];
}

function pickFields(task, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(task, field)) out[field] = task[field];
  }
  return out;
}

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function taskGet(payload) {
  const task = await findTask(payload.taskId);
  if (!task) {
    throw typedError("TASK_NOT_FOUND", `Task ${payload.taskId} not found`, false);
  }
  return { task };
}

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

  const localRest = localRestConfig();
  if (localRest) {
    await localRestRequest(localRest, `/tasks/${encodeURIComponent(taskId)}/archive`, { method: "POST", errorCode: "LOCAL_REST_ARCHIVE_FAILED" });
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

function localRestConfig() {
  const env = typeof process === "undefined" ? {} : process.env || {};
  const baseUrl = (env.SP_LOCAL_REST_URL || env.SUPER_PRODUCTIVITY_REST_URL || "").trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token: (env.SP_LOCAL_REST_TOKEN || "").trim(),
  };
}

async function localRestRequest(config, path, options = {}) {
  if (typeof fetch !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "Local REST support requires a runtime with fetch support", false);
  }
  const headers = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
  });
  if (!response.ok) {
    const body = await safeResponseText(response);
    throw typedError(options.errorCode || "LOCAL_REST_FAILED", `Local REST request failed (${response.status}): ${body || response.statusText}`, false, { status: response.status });
  }
  return parseRestResponse(response);
}

async function parseRestResponse(response) {
  const body = await safeResponseText(response);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (_err) {
    return body;
  }
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch (_err) {
    return "";
  }
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

async function taskRestore(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const localRest = localRestConfig();
  if (!localRest) {
    throw typedError("UNSUPPORTED_ACTION", "Restore requires SP_LOCAL_REST_URL or SUPER_PRODUCTIVITY_REST_URL", false);
  }
  await localRestRequest(localRest, `/tasks/${encodeURIComponent(taskId)}/restore`, { method: "POST", errorCode: "LOCAL_REST_RESTORE_FAILED" });
  return { restored: true, via: "localRest" };
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

async function validateReorderContext(taskIds, contextId, contextType) {
  if (!contextId || taskIds.length === 0) return;
  const tasks = await PluginAPI.getTasks();
  for (const taskId of taskIds) {
    const task = tasks.find((t) => t.id === taskId);
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

async function taskStart(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const localRest = localRestConfig();
  if (localRest) {
    await localRestRequest(localRest, `/tasks/${encodeURIComponent(taskId)}/start`, { method: "POST", errorCode: "LOCAL_REST_START_FAILED" });
    return { started: true, via: "localRest" };
  }
  const tasks = await PluginAPI.getTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (task.isDone) throw typedError("TASK_DONE", `Cannot start completed task ${taskId}`, false);
  const active = tasks.find((t) => t.currentTimestamp > 0 && t.id !== taskId);
  if (active) await PluginAPI.updateTask(active.id, { currentTimestamp: null });
  await PluginAPI.updateTask(taskId, { currentTimestamp: Date.now() });
  return { started: true };
}

async function taskStop() {
  const localRest = localRestConfig();
  if (localRest) {
    await localRestRequest(localRest, "/task-control/stop", { method: "POST", errorCode: "LOCAL_REST_STOP_FAILED" });
    return { stopped: true, via: "localRest" };
  }
  const tasks = await PluginAPI.getTasks();
  const active = tasks.find((t) => t.currentTimestamp > 0);
  if (!active) return { stopped: false };
  await PluginAPI.updateTask(active.id, { currentTimestamp: null });
  return { stopped: true };
}

async function taskCurrent() {
  const localRest = localRestConfig();
  if (localRest) {
    const body = await localRestRequest(localRest, "/task-control/current", { errorCode: "LOCAL_REST_CURRENT_FAILED" });
    return { task: normalizeCurrentTaskResponse(body), via: "localRest" };
  }
  const tasks = await PluginAPI.getTasks();
  const active = tasks.find((t) => t.currentTimestamp > 0);
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

function normalizeCurrentTaskResponse(body) {
  if (!body) return null;
  if (body.task !== undefined) return body.task;
  if (body.currentTask !== undefined) return body.currentTask;
  if (body.id || body.title) return body;
  return null;
}

async function taskBulkComplete(payload) {
  const taskIds = valueOf(payload || {}, "taskIds", "task_ids") || [];
  const tasks = await PluginAPI.getTasks();
  const results = [];
  for (const id of taskIds) {
    if (!tasks.find((t) => t.id === id)) {
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
      const task = existingTasks.find((t) => t.id === taskId) || null;
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

async function taskClearScheduleForDay(payload) {
  payload = payload || {};
  const date = payload.date;
  if (!isLocalDateString(date)) throw typedError("INVALID_REQUEST", "date must be YYYY-MM-DD", false);
  const includeDone = valueOf(payload, "includeDone", "include_done") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const clearDueDay = valueOf(payload, "clearDueDay", "clear_due_day") === true;
  const [start, end] = dayRangeMs(date);
  const tasks = await getTasksBySource(includeArchived ? "all" : "active");
  const updates = [];
  for (const task of tasks) {
    if (!includeDone && task.isDone) continue;
    if (!includeArchived && task.isArchived) continue;
    const patch = {};
    if (task.plannedAt != null && task.plannedAt >= start && task.plannedAt < end) patch.plannedAt = null;
    if (clearDueDay && task.dueDay === date) patch.dueDay = null;
    if (Object.keys(patch).length > 0) updates.push({ taskId: task.id, ...patch });
  }
  const out = await taskBulkUpdateCore({ ...payload, updates }, ["plannedAt", "dueDay"]);
  return { ...out, date, changedCount: out.results.filter((result) => result.success).length };
}

async function taskScheduleHealth(payload) {
  payload = payload || {};
  const date = payload.date || localDateStr(new Date());
  if (!isLocalDateString(date)) throw typedError("INVALID_REQUEST", "date must be YYYY-MM-DD", false);
  const staleBeforeDate = valueOf(payload, "staleBeforeDate", "stale_before_date") || date;
  if (!isLocalDateString(staleBeforeDate)) throw typedError("INVALID_REQUEST", "staleBeforeDate must be YYYY-MM-DD", false);
  const includeDone = valueOf(payload, "includeDone", "include_done") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const oversizedNotesThreshold = Number(valueOf(payload, "oversizedNotesThreshold", "oversized_notes_threshold") ?? 4000);
  const [start, end] = dayRangeMs(date);
  const [staleStart] = dayRangeMs(staleBeforeDate);
  const tasks = (await getTasksBySource(includeArchived ? "all" : "active"))
    .filter((task) => (includeDone || !task.isDone) && (includeArchived || !task.isArchived));

  const lists = {
    plannedToday: tasks.filter((task) => task.plannedAt != null && task.plannedAt >= start && task.plannedAt < end),
    overdue: tasks.filter((task) => task.dueDay != null && task.dueDay < date),
    unscheduledActiveTopLevel: tasks.filter((task) => !task.parentId && !task.plannedAt && !task.dueDay),
    stalePlanned: tasks.filter((task) => task.plannedAt != null && task.plannedAt < staleStart),
    staleDue: tasks.filter((task) => task.dueDay != null && task.dueDay < staleBeforeDate),
    missingEstimate: tasks.filter((task) => !Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) <= 0),
    oversizedNotes: tasks.filter((task) => String(task.notes || "").length > oversizedNotesThreshold),
    recurringGenerated: tasks.filter((task) => !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle)),
    suspiciousDatesOrEstimates: tasks.filter(hasSuspiciousDatesOrEstimates),
  };
  const compactLists = Object.fromEntries(Object.entries(lists).map(([key, value]) => [key, value.map(compactTaskSummary)]));
  const counts = Object.fromEntries(Object.entries(compactLists).map(([key, value]) => [key, value.length]));
  return { date, staleBeforeDate, counts, tasks: compactLists };
}

async function taskScheduleRange(payload) {
  payload = payload || {};
  const startDate = valueOf(payload, "startDate", "start_date");
  const endDate = valueOf(payload, "endDate", "end_date") || startDate;
  if (!isLocalDateString(startDate)) throw typedError("INVALID_REQUEST", "startDate must be YYYY-MM-DD", false);
  if (!isLocalDateString(endDate)) throw typedError("INVALID_REQUEST", "endDate must be YYYY-MM-DD", false);
  const includeDone = valueOf(payload, "includeDone", "include_done") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const [startMs] = dayRangeMs(startDate);
  const [, endMs] = dayRangeMs(endDate);
  const tasks = (await getTasksBySource(includeArchived ? "all" : "active"))
    .filter((task) => (includeDone || !task.isDone) && (includeArchived || !task.isArchived))
    .filter((task) => task.plannedAt != null && task.plannedAt >= startMs && task.plannedAt < endMs)
    .sort((a, b) => Number(a.plannedAt || 0) - Number(b.plannedAt || 0) || String(a.title || "").localeCompare(String(b.title || "")));
  const byDate = new Map(localDateRange(startDate, endDate).map((date) => [date, []]));
  for (const task of tasks) {
    const date = localDateStr(new Date(task.plannedAt));
    if (byDate.has(date)) byDate.get(date).push(compactTaskSummary(task));
  }
  return { startDate, endDate, days: [...byDate.entries()].map(([date, dayTasks]) => ({ date, tasks: dayTasks })) };
}

async function taskFindStaleSchedule(payload) {
  payload = payload || {};
  const beforeDate = valueOf(payload, "beforeDate", "before_date");
  if (!isLocalDateString(beforeDate)) throw typedError("INVALID_REQUEST", "beforeDate must be YYYY-MM-DD", false);
  const includeDueDay = valueOf(payload, "includeDueDay", "include_due_day") !== false;
  const includePlannedAt = valueOf(payload, "includePlannedAt", "include_planned_at") !== false;
  const includeCompleted = valueOf(payload, "includeCompleted", "include_completed") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const [beforeMs] = dayRangeMs(beforeDate);
  const tasks = (await getTasksBySource(includeArchived ? "all" : "active"))
    .filter((task) => (includeCompleted || !task.isDone) && (includeArchived || !task.isArchived))
    .map((task) => ({ task, staleDueDay: includeDueDay && task.dueDay != null && task.dueDay < beforeDate, stalePlannedAt: includePlannedAt && task.plannedAt != null && task.plannedAt < beforeMs }))
    .filter((entry) => entry.staleDueDay || entry.stalePlannedAt)
    .map((entry) => ({ ...compactTaskSummary(entry.task), staleDueDay: entry.staleDueDay, stalePlannedAt: entry.stalePlannedAt }));
  return { beforeDate, tasks };
}

async function taskFindUnscheduledActive(payload) {
  payload = payload || {};
  const topLevelOnly = valueOf(payload, "topLevelOnly", "top_level_only") !== false;
  const missingEstimateOnly = valueOf(payload, "missingEstimateOnly", "missing_estimate_only") === true;
  const missingDueDateOnly = valueOf(payload, "missingDueDateOnly", "missing_due_date_only") === true;
  const includeProjectIds = valueOf(payload, "includeProjectIds", "include_project_ids") || [];
  const excludeProjectIds = valueOf(payload, "excludeProjectIds", "exclude_project_ids") || [];
  const includeTagIds = valueOf(payload, "includeTagIds", "include_tag_ids") || [];
  const excludeTagIds = valueOf(payload, "excludeTagIds", "exclude_tag_ids") || [];
  const tasks = (await getTasksBySource("active"))
    .filter((task) => !task.isDone && !task.isArchived)
    .filter((task) => task.plannedAt == null && task.dueDay == null)
    .filter((task) => !topLevelOnly || !task.parentId)
    .filter((task) => !missingEstimateOnly || !Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) <= 0)
    .filter((task) => !missingDueDateOnly || !task.dueDay)
    .filter((task) => includeProjectIds.length === 0 || includeProjectIds.includes(task.projectId))
    .filter((task) => excludeProjectIds.length === 0 || !excludeProjectIds.includes(task.projectId))
    .filter((task) => includeTagIds.length === 0 || includeTagIds.some((tagId) => (task.tagIds || []).includes(tagId)))
    .filter((task) => excludeTagIds.length === 0 || !excludeTagIds.some((tagId) => (task.tagIds || []).includes(tagId)))
    .map(compactTaskSummary);
  return { tasks };
}

function compactTaskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    parentId: task.parentId,
    dueDay: task.dueDay,
    plannedAt: task.plannedAt,
    timeEstimate: task.timeEstimate,
    isDone: !!task.isDone,
    isArchived: !!task.isArchived,
    notesLength: String(task.notes || "").length,
  };
}

function hasSuspiciousDatesOrEstimates(task) {
  const tenYears = Date.now() + 10 * 365 * 86400000;
  const oneYearMs = 365 * 86400000;
  if (task.dueDay != null && !isLocalDateString(task.dueDay)) return true;
  if (task.plannedAt != null && (!Number.isFinite(Number(task.plannedAt)) || Number(task.plannedAt) < 0 || Number(task.plannedAt) > tenYears)) return true;
  if (task.timeEstimate != null && (!Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) < 0 || Number(task.timeEstimate) > oneYearMs)) return true;
  return false;
}

function isLocalDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayRangeMs(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  return [start, start + 86400000];
}

function localDateRange(startDate, endDate) {
  const dates = [];
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endMs] = dayRangeMs(endDate);
  for (let cursor = new Date(startYear, startMonth - 1, startDay); cursor.getTime() <= endMs; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(localDateStr(cursor));
    if (localDateStr(cursor) === endDate) break;
  }
  return dates;
}

async function taskPlanToday(payload) {
  const taskIds = valueOf(payload || {}, "taskIds", "task_ids") || [];
  const plannedAt = payload?.unplan ? null : startOfTodayMs();
  return taskBulkUpdate({ updates: taskIds.map((taskId) => ({ taskId, plannedAt })) });
}

async function taskAddTag(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  const tagId = valueOf(payload || {}, "tagId", "tag_id");
  if (!taskId || !tagId) throw typedError("INVALID_REQUEST", "taskId and tagId are required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  const tagIds = task.tagIds || [];
  if (tagIds.includes(tagId)) return { added: false };
  await PluginAPI.updateTask(taskId, { tagIds: [...tagIds, tagId] });
  return { added: true };
}

async function taskRemoveTag(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  const tagId = valueOf(payload || {}, "tagId", "tag_id");
  if (!taskId || !tagId) throw typedError("INVALID_REQUEST", "taskId and tagId are required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  const tagIds = task.tagIds || [];
  if (!tagIds.includes(tagId)) throw typedError("TAG_NOT_ON_TASK", `Tag ${tagId} not on task ${taskId}`, false);
  await PluginAPI.updateTask(taskId, { tagIds: tagIds.filter((id) => id !== tagId) });
  return { removed: true };
}

async function taskMoveToProject(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  const projectId = valueOf(payload || {}, "projectId", "project_id");
  if (!taskId || !projectId) throw typedError("INVALID_REQUEST", "taskId and projectId are required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (task.parentId) throw typedError("TASK_IS_SUBTASK", `Cannot move subtask ${taskId}`, false, { parentId: task.parentId });
  if (typeof PluginAPI.getAllProjects === "function") {
    const projects = await PluginAPI.getAllProjects();
    if (!projects.find((project) => project.id === projectId)) throw typedError("PROJECT_NOT_FOUND", `Project ${projectId} not found`, false);
  }
  await PluginAPI.updateTask(taskId, { projectId });
  return { moved: true };
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

function startOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

module.exports = {
  "task.create": taskCreate,
  "task.createWithSubtasks": taskCreateWithSubtasks,
  "task.list": taskList,
  "task.get": taskGet,
  "task.update": taskUpdate,
  "task.complete": taskComplete,
  "task.uncomplete": taskUncomplete,
  "task.archive": taskArchive,
  "task.restore": taskRestore,
  "task.delete": taskDelete,
  "task.addTime": taskAddTime,
  "task.reorder": taskReorder,
  "task.reorderTasks": taskReorder,
  "task.start": taskStart,
  "task.stop": taskStop,
  "task.current": taskCurrent,
  "task.bulkComplete": taskBulkComplete,
  "task.bulkUpdate": taskBulkUpdate,
  "task.bulkReschedule": taskBulkReschedule,
  "task.clearScheduleForDay": taskClearScheduleForDay,
  "task.scheduleHealth": taskScheduleHealth,
  "task.scheduleRange": taskScheduleRange,
  "task.findStaleSchedule": taskFindStaleSchedule,
  "task.findUnscheduledActive": taskFindUnscheduledActive,
  "task.planToday": taskPlanToday,
  "task.addTag": taskAddTag,
  "task.removeTag": taskRemoveTag,
  "task.moveToProject": taskMoveToProject,
  "task.worklog": taskWorklog,
};
