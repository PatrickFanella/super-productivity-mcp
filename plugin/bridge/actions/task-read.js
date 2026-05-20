const { typedError } = require("../errors");
const { findTask, getTasksBySource, localDateStr, startOfTodayMs, valueOf } = require("./task-common");
const { pickFields, sortAndPageTasks, withSyntheticTaskFields } = require("./task-shape");

async function taskList(payload) {
  payload = payload || {};
  const includeDone = payload?.includeDone !== false;
  let tasks = await getTasksBySource(payload.source || "active");
  if (!includeDone) {
    tasks = tasks.filter((task) => !task.isDone);
  }
  const projectId = valueOf(payload, "projectId", "project_id");
  if (projectId) {
    tasks = tasks.filter((task) => task.projectId === projectId);
  }
  const tagId = valueOf(payload, "tagId", "tag_id");
  if (tagId) {
    tasks = tasks.filter((task) => Array.isArray(task.tagIds) && task.tagIds.includes(tagId));
  }
  const isDone = valueOf(payload, "isDone", "is_done");
  if (typeof isDone === "boolean") {
    tasks = tasks.filter((task) => !!task.isDone === isDone);
  }
  const isArchived = valueOf(payload, "isArchived", "is_archived");
  if (typeof isArchived === "boolean") {
    tasks = tasks.filter((task) => !!task.isArchived === isArchived);
  }
  const search = String(payload.search || "").trim().toLowerCase();
  if (search) {
    tasks = tasks.filter((task) => `${task.title || ""}\n${task.notes || ""}`.toLowerCase().includes(search));
  }
  if (valueOf(payload, "parentsOnly", "parents_only")) {
    tasks = tasks.filter((task) => !task.parentId);
  }
  if (payload?.overdue) {
    const today = localDateStr(new Date());
    tasks = tasks.filter((task) => task.dueDay != null && task.dueDay < today);
  }
  if (payload?.unscheduled) {
    tasks = tasks.filter((task) => !task.dueDay && !task.dueWithTime);
  }
  if (payload?.plannedForToday) {
    const start = startOfTodayMs();
    const end = start + 86400000;
    tasks = tasks.filter((task) => task.plannedAt != null && task.plannedAt >= start && task.plannedAt < end);
  }
  if (valueOf(payload, "recurringOnly", "recurring_only")) {
    tasks = tasks.filter((task) => !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle));
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

async function taskArchivedList(payload) {
  if (typeof PluginAPI.getArchivedTasks !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "PluginAPI.getArchivedTasks is not available in this Super Productivity runtime", false);
  }
  return taskList({ ...(payload || {}), source: "archived" });
}

async function taskCurrentContextList(payload) {
  if (typeof PluginAPI.getCurrentContextTasks !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "PluginAPI.getCurrentContextTasks is not available in this Super Productivity runtime", false);
  }
  payload = payload || {};
  const includeDone = payload.includeDone !== false;
  let tasks = (await PluginAPI.getCurrentContextTasks()).map((task) => ({ ...task, isArchived: task.isArchived ?? false }));
  if (!includeDone) tasks = tasks.filter((task) => !task.isDone);
  if (valueOf(payload, "includeSynthetic", "include_synthetic")) tasks = await withSyntheticTaskFields(tasks);
  tasks = sortAndPageTasks(tasks, payload);
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  if (fields.length > 0) tasks = tasks.map((task) => pickFields(task, fields));
  return { tasks };
}

async function taskGet(payload) {
  const task = await findTask(payload.taskId);
  if (!task) {
    throw typedError("TASK_NOT_FOUND", `Task ${payload.taskId} not found`, false);
  }
  return { task };
}

module.exports = {
  taskArchivedList,
  taskCurrentContextList,
  taskGet,
  taskList,
};
