async function withSyntheticTaskFields(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const projects = typeof PluginAPI.getAllProjects === "function" ? await PluginAPI.getAllProjects() : [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return tasks.map((task) => ({
    ...task,
    noteLength: String(task.notes || "").length,
    subtaskCount: Array.isArray(task.subTaskIds) ? task.subTaskIds.length : tasks.filter((candidate) => candidate.parentId === task.id).length,
    isRecurring: !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle),
    ...scheduleFields(task),
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
  // plannedAt sorts by the normalized time, so v20 dueWithTime tasks sort too.
  const av = field === "plannedAt" ? taskSchedule(a).at : a[field];
  const bv = field === "plannedAt" ? taskSchedule(b).at : b[field];
  if (av == null && bv == null) return String(a.title || "").localeCompare(String(b.title || ""));
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" || typeof bv === "number") return Number(av) - Number(bv);
  return String(av).localeCompare(String(bv)) || String(a.title || "").localeCompare(String(b.title || ""));
}

// validTimestamp returns a positive finite millisecond value, or null.
function validTimestamp(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// taskSchedule is the one place that reads a task's schedule fields. Stock
// v20 stores timed work in dueWithTime and day-only work in dueDay; older
// suites wrote plannedAt. dueWithTime wins over plannedAt, as it does in the
// app's REST API, and a timed task wins over its dueDay. A day-only task
// never gets a time.
//   kind: "timed" | "day" | "none"; at: ms or null; day: local YYYY-MM-DD or null
function taskSchedule(task) {
  const dueWithTime = validTimestamp(task.dueWithTime);
  if (dueWithTime != null) return { kind: "timed", at: dueWithTime, day: localDateStr(new Date(dueWithTime)), source: "dueWithTime" };
  const plannedAt = validTimestamp(task.plannedAt);
  if (plannedAt != null) return { kind: "timed", at: plannedAt, day: localDateStr(new Date(plannedAt)), source: "plannedAt" };
  if (isLocalDateString(task.dueDay)) return { kind: "day", at: null, day: task.dueDay, source: "dueDay" };
  return { kind: "none", at: null, day: null, source: null };
}

// scheduleFields is the normalized schedule as output fields.
function scheduleFields(task) {
  const schedule = taskSchedule(task);
  return { scheduleKind: schedule.kind, scheduledDay: schedule.day, scheduledAt: schedule.at };
}

// compactTaskSummary keeps plannedAt as a compatibility field: it carries the
// normalized time of a timed task (from dueWithTime or legacy plannedAt) and
// is null for day-only and unscheduled tasks.
function compactTaskSummary(task) {
  const schedule = taskSchedule(task);
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    parentId: task.parentId,
    dueDay: task.dueDay,
    dueWithTime: task.dueWithTime ?? null,
    plannedAt: schedule.at,
    scheduleKind: schedule.kind,
    scheduledDay: schedule.day,
    deadlineDay: task.deadlineDay ?? null,
    deadlineWithTime: task.deadlineWithTime ?? null,
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
  for (const field of ["plannedAt", "dueWithTime"]) {
    const value = task[field];
    if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > tenYears)) return true;
  }
  if (task.timeEstimate != null && (!Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) < 0 || Number(task.timeEstimate) > oneYearMs)) return true;
  return false;
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

// isLocalDateString accepts a real calendar date in YYYY-MM-DD form, so
// "2026-02-30" is refused rather than rolled over to March.
function isLocalDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// dayRangeMs is the local calendar day as [start, next day's start). It uses
// calendar arithmetic, so DST days are 23 or 25 hours long.
function dayRangeMs(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return [new Date(year, month - 1, day).getTime(), new Date(year, month - 1, day + 1).getTime()];
}

// appTodayDay is the day the app files a task under for Today
// (isTaskInToday in the v20 REST routes): dueWithTime shifted by the day-start
// offset, else dueDay. It ignores legacy plannedAt, which v20 does not store.
function appTodayDay(task, startOfNextDayDiffMs) {
  const dueWithTime = validTimestamp(task.dueWithTime);
  if (dueWithTime != null) return localDateStr(new Date(dueWithTime - (Number(startOfNextDayDiffMs) || 0)));
  return isLocalDateString(task.dueDay) ? task.dueDay : null;
}

// scheduleDayIn returns the day a normalized schedule falls on when days start
// startOfNextDayDiffMs after midnight (the app's logical day). With 0 it is
// the calendar day.
function scheduleDayIn(schedule, startOfNextDayDiffMs) {
  if (schedule.kind !== "timed") return schedule.day;
  return localDateStr(new Date(schedule.at - (Number(startOfNextDayDiffMs) || 0)));
}

module.exports = {
  appTodayDay,
  compactTaskSummary,
  dayRangeMs,
  hasSuspiciousDatesOrEstimates,
  isLocalDateString,
  localDateStr,
  pickFields,
  scheduleDayIn,
  scheduleFields,
  sortAndPageTasks,
  taskSchedule,
  valueOf,
  withSyntheticTaskFields,
};
