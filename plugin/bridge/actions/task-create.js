const { typedError } = require("../errors");
const { parseTaskShortSyntax } = require("./task-short-syntax");
const { localDateStr, mergeUnique, valueOf } = require("./task-common");
const { buildRepeatRecurrence, taskSetRecurrence } = require("./task-recurrence");

const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Rejects 2026-02-30 and similar strings that match the pattern but are not
// calendar days.
function isCalendarDay(day) {
  if (typeof day !== "string" || !DUE_DATE_RE.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return year >= 1000 && utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
}

// Validates the explicit scheduling fields. Returns { dueDay, dueWithTime }
// with only the fields that were given.
function explicitDue(payload) {
  const dueDate = valueOf(payload, "dueDate", "due_date");
  const dueTime = valueOf(payload, "dueTime", "due_time");
  if (dueDate === undefined) {
    if (dueTime !== undefined) throw typedError("INVALID_REQUEST", "dueTime requires dueDate", false);
    return {};
  }
  if (!isCalendarDay(dueDate)) throw typedError("INVALID_REQUEST", "dueDate must be a calendar day as YYYY-MM-DD", false);
  if (dueTime === undefined) return { dueDay: dueDate };
  if (typeof dueTime !== "string" || !DUE_TIME_RE.test(dueTime)) {
    throw typedError("INVALID_REQUEST", "dueTime must be a 24-hour time as HH:MM", false);
  }
  const [year, month, date] = dueDate.split("-").map(Number);
  const [hour, minute] = dueTime.split(":").map(Number);
  return { dueDay: dueDate, dueWithTime: new Date(year, month - 1, date, hour, minute).getTime() };
}

async function buildTaskData(payload) {
  const literal = payload.literal === true;
  const parsed = literal ? { title: payload.title || "", tagIds: [] } : await parseTaskShortSyntax(payload.title || "");
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
  // Explicit fields win over anything parsed from the title.
  const due = explicitDue(payload);
  if (due.dueDay != null) {
    data.dueDay = due.dueDay;
    delete data.dueWithTime;
  }
  if (due.dueWithTime != null) data.dueWithTime = due.dueWithTime;
  return data;
}

async function taskCreate(payload) {
  const data = await buildTaskData(payload);
  // Validate recurrence before the task exists, so a bad repeat argument
  // never leaves a half-made task behind.
  const recurrence = payload.repeat
    ? buildRepeatRecurrence(payload.repeat, {
        startDate: valueOf(payload, "dueDate", "due_date") || localDateStr(new Date()),
        startTime: valueOf(payload, "dueTime", "due_time"),
      })
    : null;
  const taskId = await PluginAPI.addTask(data);
  if (!recurrence) return { taskId };
  // The task exists now. Report a recurrence failure next to the id instead
  // of throwing, so the caller does not retry and create a duplicate.
  try {
    const result = await taskSetRecurrence({ taskId, recurrence });
    return { taskId, repeatCfgId: result.repeatCfgId };
  } catch (error) {
    return {
      taskId,
      recurrenceError: { code: error?.code || "RECURRENCE_FAILED", message: error?.message || String(error) },
    };
  }
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

module.exports = {
  buildTaskData,
  taskCreate,
  taskCreateWithSubtasks,
};
