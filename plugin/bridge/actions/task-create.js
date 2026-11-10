const { typedError } = require("../errors");
const { parseDueAndEstimate, parseTaskShortSyntax } = require("./task-short-syntax");
const { localDateStr, mergeUnique, valueOf } = require("./task-common");
const { buildRepeatRecurrence, taskSetRecurrence } = require("./task-recurrence");
const { hostTimeZone, resolveZonedWallTime } = require("./task-schedule");

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
  // A time the clocks skip or repeat is refused rather than guessed.
  const resolved = resolveZonedWallTime(dueDate, dueTime, hostTimeZone());
  return { dueDay: dueDate, dueWithTime: resolved.ms };
}

// buildTaskData parses the title once, here, and returns the addTask data
// plus a time to set afterwards (PluginAPI.addTask has no dueWithTime).
// isIgnoreShortSyntax stops the app from parsing the result a second time.
// A subtask takes its parent's project and has no tags, as in the app, so
// only due dates and estimates are read from its title.
async function buildTaskData(payload) {
  const literal = payload.literal === true;
  const parentId = valueOf(payload, "parentId", "parent_id");
  const title = payload.title || "";
  let parsed;
  if (literal) parsed = { title, tagIds: [] };
  else if (parentId) parsed = { ...parseDueAndEstimate(title), tagIds: [] };
  else parsed = await parseTaskShortSyntax(title);
  const data = {
    title: parsed.title,
    notes: payload.notes || "",
    timeEstimate: valueOf(payload, "timeEstimate", "time_estimate") ?? parsed.timeEstimate ?? 0,
    isIgnoreShortSyntax: true,
  };
  if (parentId) {
    data.parentId = parentId;
  } else {
    data.projectId = valueOf(payload, "projectId", "project_id") || parsed.projectId;
    data.tagIds = mergeUnique(valueOf(payload, "tagIds", "tag_ids") || [], parsed.tagIds);
  }
  if (parsed.timeSpent != null) data.timeSpent = parsed.timeSpent;
  let dueWithTime = parsed.dueWithTime;
  if (parsed.dueDay != null) data.dueDay = parsed.dueDay;
  // Explicit fields win over anything parsed from the title.
  const due = explicitDue(payload);
  if (due.dueDay != null) {
    data.dueDay = due.dueDay;
    dueWithTime = due.dueWithTime;
  }
  // A timed task is filed by its time: v20 keeps dueDay empty for it.
  if (dueWithTime != null) delete data.dueDay;
  return { data, dueWithTime: dueWithTime ?? null };
}

// createTask adds the task, then sets its time. If the time cannot be set,
// the created task id is still returned with scheduleError, so a caller does
// not retry and create a duplicate.
async function createTask(built) {
  const taskId = await PluginAPI.addTask(built.data);
  const out = { taskId };
  if (built.dueWithTime != null) {
    try {
      await PluginAPI.updateTask(taskId, { dueWithTime: built.dueWithTime, dueDay: null });
    } catch (error) {
      out.scheduleError = { code: error?.code || "SCHEDULE_FAILED", message: error?.message || String(error) };
    }
  }
  return out;
}

async function taskCreate(payload) {
  const built = await buildTaskData(payload);
  // Validate recurrence before the task exists, so a bad repeat argument
  // never leaves a half-made task behind.
  const recurrence = payload.repeat
    ? buildRepeatRecurrence(payload.repeat, {
        startDate: valueOf(payload, "dueDate", "due_date") || localDateStr(new Date()),
        startTime: valueOf(payload, "dueTime", "due_time"),
      })
    : null;
  const created = await createTask(built);
  const { taskId } = created;
  if (!recurrence) return created;
  // The task exists now. Report a recurrence failure next to the id instead
  // of throwing, so the caller does not retry and create a duplicate.
  try {
    const result = await taskSetRecurrence({ taskId, recurrence });
    return { ...created, repeatCfgId: result.repeatCfgId };
  } catch (error) {
    return {
      ...created,
      recurrenceError: { code: error?.code || "RECURRENCE_FAILED", message: error?.message || String(error) },
    };
  }
}

async function taskCreateWithSubtasks(payload) {
  if (!Array.isArray(payload?.subtasks)) {
    throw typedError("INVALID_REQUEST", "subtasks must be an array", false);
  }
  const parent = await createTask(await buildTaskData(payload));
  const parentId = parent.taskId;
  const subtaskIds = [];
  const scheduleErrors = [];
  for (const subtask of payload.subtasks) {
    const child = await createTask(await buildTaskData({ ...subtask, parentId }));
    subtaskIds.push(child.taskId);
    if (child.scheduleError) scheduleErrors.push({ taskId: child.taskId, ...child.scheduleError });
  }
  const out = { parentId, subtaskIds };
  if (parent.scheduleError) scheduleErrors.unshift({ taskId: parentId, ...parent.scheduleError });
  if (scheduleErrors.length) out.scheduleErrors = scheduleErrors;
  return out;
}

module.exports = {
  buildTaskData,
  taskCreate,
  taskCreateWithSubtasks,
};
