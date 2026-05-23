const { typedError } = require("../errors");
const { findTask, localDateStr, valueOf } = require("./task-common");

const ADD_REPEAT_CFG_TO_TASK = "[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task";
const UPDATE_REPEAT_CFG = "[TaskRepeatCfg] Update TaskRepeatCfg";
const DELETE_REPEAT_CFG = "[Task Shared] deleteTaskRepeatCfg";

const REPEAT_CYCLES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const QUICK_SETTINGS = new Set([
  "DAILY",
  "WEEKLY_CURRENT_WEEKDAY",
  "MONTHLY_CURRENT_DATE",
  "MONTHLY_FIRST_DAY",
  "MONTHLY_LAST_DAY",
  "MONTHLY_NTH_WEEKDAY",
  "MONDAY_TO_FRIDAY",
  "YEARLY_CURRENT_DATE",
  "CUSTOM",
]);
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function newRepeatCfgId() {
  return `mcp_repeat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function persistenceMeta(entityId, opType) {
  return { isPersistent: true, entityType: "TASK_REPEAT_CFG", entityId, opType };
}

function assertDispatchActionAvailable() {
  if (typeof PluginAPI.dispatchAction !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "PluginAPI.dispatchAction is required for recurrence tools", false);
  }
}

function normalizeRepeatCycle(value) {
  if (!REPEAT_CYCLES.has(value)) {
    throw typedError("INVALID_REQUEST", `repeatCycle must be one of ${[...REPEAT_CYCLES].join(", ")}`, false);
  }
  return value;
}

function normalizeQuickSetting(value, repeatCycle) {
  if (value == null) return repeatCycle === "DAILY" ? "DAILY" : "CUSTOM";
  if (!QUICK_SETTINGS.has(value)) {
    throw typedError("INVALID_REQUEST", `quickSetting must be one of ${[...QUICK_SETTINGS].join(", ")}`, false);
  }
  return value;
}

function normalizeRepeatEvery(value) {
  const n = Number(value == null ? 1 : value);
  if (!Number.isInteger(n) || n < 1) {
    throw typedError("INVALID_REQUEST", "repeatEvery must be an integer >= 1", false);
  }
  return n;
}

function normalizeTime(value) {
  if (value == null || value === "") return undefined;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw typedError("INVALID_REQUEST", "startTime must be HH:MM", false);
  }
  return value;
}

function normalizeDate(value) {
  if (value == null || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw typedError("INVALID_REQUEST", "startDate must be YYYY-MM-DD", false);
  }
  return value;
}

function normalizeSubTaskTemplates(value) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw typedError("INVALID_REQUEST", "subTaskTemplates must be an array", false);
  return value.map((item) => {
    if (!item || typeof item.title !== "string" || item.title.trim() === "") {
      throw typedError("INVALID_REQUEST", "each subTaskTemplate requires title", false);
    }
    const out = { title: item.title };
    const estimate = valueOf(item, "timeEstimate", "time_estimate");
    if (estimate != null) out.timeEstimate = Number(estimate);
    if (item.notes != null) out.notes = item.notes;
    return out;
  });
}

function setIfPresent(out, input, camelName, snakeName, normalize) {
  const value = valueOf(input, camelName, snakeName);
  if (value !== undefined) out[camelName] = normalize ? normalize(value) : value;
}

function normalizeRepeatCfgForCreate(input, task) {
  const repeatCycle = normalizeRepeatCycle(valueOf(input, "repeatCycle", "repeat_cycle"));
  const quickSetting = normalizeQuickSetting(valueOf(input, "quickSetting", "quick_setting"), repeatCycle);
  const repeatEvery = normalizeRepeatEvery(valueOf(input, "repeatEvery", "repeat_every"));
  const today = localDateStr(new Date());
  const cfg = {
    id: newRepeatCfgId(),
    projectId: valueOf(input, "projectId", "project_id") ?? task.projectId ?? null,
    lastTaskCreation: Date.now(),
    lastTaskCreationDay: today,
    title: input.title ?? task.title ?? null,
    tagIds: valueOf(input, "tagIds", "tag_ids") ?? task.tagIds ?? [],
    order: 0,
    defaultEstimate: valueOf(input, "defaultEstimate", "default_estimate"),
    startTime: normalizeTime(valueOf(input, "startTime", "start_time")),
    startDate: normalizeDate(valueOf(input, "startDate", "start_date")),
    repeatEvery,
    isPaused: valueOf(input, "isPaused", "is_paused") === true,
    quickSetting,
    repeatCycle,
    repeatFromCompletionDate: valueOf(input, "repeatFromCompletionDate", "repeat_from_completion_date") === true,
    waitForCompletion: valueOf(input, "waitForCompletion", "wait_for_completion") === true,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
    notes: input.notes ?? task.notes,
    shouldInheritSubtasks: valueOf(input, "shouldInheritSubtasks", "should_inherit_subtasks") === true,
    disableAutoUpdateSubtasks: valueOf(input, "disableAutoUpdateSubtasks", "disable_auto_update_subtasks") === true,
    skipOverdue: valueOf(input, "skipOverdue", "skip_overdue") === true,
  };
  for (const day of WEEKDAYS) cfg[day] = input[day] === true;
  if (repeatCycle === "DAILY") cfg.monday = cfg.tuesday = cfg.wednesday = cfg.thursday = cfg.friday = cfg.saturday = cfg.sunday = true;
  if (quickSetting === "MONDAY_TO_FRIDAY") cfg.monday = cfg.tuesday = cfg.wednesday = cfg.thursday = cfg.friday = true;
  const templates = normalizeSubTaskTemplates(input.subTaskTemplates || input.sub_task_templates);
  if (templates) cfg.subTaskTemplates = templates;
  return cfg;
}

function normalizeRepeatCfgChanges(input) {
  const changes = {};
  setIfPresent(changes, input, "repeatCycle", "repeat_cycle", normalizeRepeatCycle);
  setIfPresent(changes, input, "quickSetting", "quick_setting", (value) => normalizeQuickSetting(value, changes.repeatCycle || "WEEKLY"));
  setIfPresent(changes, input, "repeatEvery", "repeat_every", normalizeRepeatEvery);
  setIfPresent(changes, input, "startTime", "start_time", normalizeTime);
  setIfPresent(changes, input, "startDate", "start_date", normalizeDate);
  setIfPresent(changes, input, "isPaused", "is_paused");
  setIfPresent(changes, input, "waitForCompletion", "wait_for_completion");
  setIfPresent(changes, input, "skipOverdue", "skip_overdue");
  setIfPresent(changes, input, "repeatFromCompletionDate", "repeat_from_completion_date");
  setIfPresent(changes, input, "defaultEstimate", "default_estimate");
  setIfPresent(changes, input, "title", "title");
  setIfPresent(changes, input, "notes", "notes");
  setIfPresent(changes, input, "tagIds", "tag_ids");
  setIfPresent(changes, input, "projectId", "project_id");
  for (const day of WEEKDAYS) setIfPresent(changes, input, day, day);
  if (Object.keys(changes).length === 0) throw typedError("NO_UPDATE_FIELDS", "No recurrence changes provided", false);
  return changes;
}

async function taskSetRecurrence(payload) {
  assertDispatchActionAvailable();
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (task.repeatCfgId) throw typedError("TASK_ALREADY_RECURRING", `Task ${taskId} already has repeatCfgId ${task.repeatCfgId}`, false);
  const recurrence = payload.recurrence || {};
  const taskRepeatCfg = normalizeRepeatCfgForCreate(recurrence, task);
  await PluginAPI.dispatchAction({
    type: ADD_REPEAT_CFG_TO_TASK,
    taskId,
    taskRepeatCfg,
    startTime: taskRepeatCfg.startTime,
    remindAt: taskRepeatCfg.remindAt,
    meta: persistenceMeta(taskRepeatCfg.id, "CRT"),
  });
  return { repeatCfgId: taskRepeatCfg.id, created: true };
}

async function taskUpdateRecurrence(payload) {
  assertDispatchActionAvailable();
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (!task.repeatCfgId) throw typedError("TASK_NOT_RECURRING", `Task ${taskId} has no repeatCfgId`, false);
  const changes = normalizeRepeatCfgChanges(payload.changes || {});
  await PluginAPI.dispatchAction({
    type: UPDATE_REPEAT_CFG,
    taskRepeatCfg: { id: task.repeatCfgId, changes },
    isAskToUpdateAllTaskInstances: valueOf(payload || {}, "isAskToUpdateAllTaskInstances", "is_ask_to_update_all_task_instances") === true,
    meta: persistenceMeta(task.repeatCfgId, "UPD"),
  });
  return { repeatCfgId: task.repeatCfgId, updated: true };
}

async function taskDeleteRecurrence(payload) {
  assertDispatchActionAvailable();
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (!task.repeatCfgId) throw typedError("TASK_NOT_RECURRING", `Task ${taskId} has no repeatCfgId`, false);
  await PluginAPI.dispatchAction({
    type: DELETE_REPEAT_CFG,
    taskRepeatCfgId: task.repeatCfgId,
    meta: persistenceMeta(task.repeatCfgId, "DEL"),
  });
  return { repeatCfgId: task.repeatCfgId, deleted: true };
}

module.exports = {
  taskDeleteRecurrence,
  taskSetRecurrence,
  taskUpdateRecurrence,
};
