// Canonical schedule writes for stock v20. PluginAPI.updateTask applies fields
// as given, so this module produces the whole consistent shape the app's own
// scheduling actions produce:
//
//   timed:     { dueWithTime: t, dueDay: null }  (the reminder moves with it)
//   day-only:  { dueDay: d, dueWithTime: null, remindAt: null }
//   cleared:   { dueWithTime: null, remindAt: null } and/or { dueDay: null }
//
// plannedAt is a compatibility alias for dueWithTime. dueWithTime wins only
// when both are equal; different values are refused. A stale legacy plannedAt
// on the task is cleared so later reads do not resurrect it.
const { typedError } = require("../errors");
const { isLocalDateString, localDateStr, taskSchedule } = require("./task-shape");

const SCHEDULE_INPUTS = ["dueDay", "dueWithTime", "plannedAt"];

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function timestampInput(value, name) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) throw typedError("INVALID_REQUEST", `${name} must be a positive millisecond timestamp or null`, false);
  return value;
}

function hasScheduleInput(input) {
  return SCHEDULE_INPUTS.some((key) => hasOwn(input, key));
}

// scheduleWrite returns the fields to write for the schedule inputs in input
// ({dueDay?, dueWithTime?, plannedAt?}) on task. It throws INVALID_REQUEST for
// conflicting or invalid inputs, before anything is written.
function scheduleWrite(input, task) {
  if (!hasScheduleInput(input)) return {};
  const current = taskSchedule(task || {});
  let time;
  let hasTime = false;
  if (hasOwn(input, "dueWithTime")) {
    time = timestampInput(input.dueWithTime, "dueWithTime");
    hasTime = true;
  }
  if (hasOwn(input, "plannedAt")) {
    const alias = timestampInput(input.plannedAt, "plannedAt");
    if (hasTime && alias !== time) {
      throw typedError("INVALID_REQUEST", "plannedAt is an alias of dueWithTime; pass one of them, or the same value in both", false);
    }
    time = alias;
    hasTime = true;
  }
  let day;
  const hasDay = hasOwn(input, "dueDay");
  if (hasDay) {
    day = input.dueDay === "" ? null : input.dueDay;
    if (day !== null && !isLocalDateString(day)) throw typedError("INVALID_REQUEST", "dueDay must be a valid YYYY-MM-DD date or null", false);
  }

  const patch = {};
  if (hasTime && time !== null) {
    if (hasDay && day !== null && day !== localDateStr(new Date(time))) {
      throw typedError("INVALID_REQUEST", `dueDay ${day} does not match the day of dueWithTime (${localDateStr(new Date(time))}); a timed task is filed by its time`, false);
    }
    patch.dueWithTime = time;
    patch.dueDay = null;
    // Moving the time moves the reminder and keeps its offset, as the app does.
    const remindAt = Number(task && task.remindAt);
    if (current.kind === "timed" && Number.isFinite(remindAt) && remindAt > 0) patch.remindAt = remindAt + (time - current.at);
  } else if (hasTime) {
    // Clearing the time dismisses its reminder.
    patch.dueWithTime = null;
    patch.remindAt = null;
    if (hasDay) patch.dueDay = day;
  } else if (day !== null) {
    if (current.kind === "timed") {
      throw typedError("INVALID_REQUEST", "This task has a time. To make it day-only, pass dueWithTime:null together with dueDay; to move it, pass a new dueWithTime.", false);
    }
    patch.dueDay = day;
  } else {
    patch.dueDay = null;
  }
  // A new or cleared time replaces a stale legacy plannedAt.
  if (task && task.plannedAt != null && hasTime) patch.plannedAt = null;
  return patch;
}

// dayOnlyPatch files a task under day as day-only work.
function dayOnlyPatch(task, day) {
  const patch = { dueDay: day, dueWithTime: null, remindAt: null };
  if (task && task.plannedAt != null) patch.plannedAt = null;
  return patch;
}

// clearPatch removes the whole schedule.
function clearPatch(task) {
  const patch = { dueDay: null, dueWithTime: null, remindAt: null };
  if (task && task.plannedAt != null) patch.plannedAt = null;
  return patch;
}

module.exports = {
  SCHEDULE_INPUTS,
  clearPatch,
  dayOnlyPatch,
  hasScheduleInput,
  scheduleWrite,
};
