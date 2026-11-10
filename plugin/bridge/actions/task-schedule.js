const { typedError } = require("../errors");
const { dayRangeMs, findTask, getDayContext, getTasksBySource, isLocalDateString, localDateStr, valueOf } = require("./task-common");
const { compactTaskSummary, hasSuspiciousDatesOrEstimates, scheduleDayIn, taskSchedule } = require("./task-shape");
const { applyPatches } = require("./task-mutate");
const { scheduleWrite } = require("./task-schedule-write");

// taskClearScheduleForDay removes the time from tasks timed on date (a
// calendar day), dismissing their reminders; they stay on that day as
// day-only work. With clearDueDay they, and day-only tasks on date, are
// unscheduled.
async function taskClearScheduleForDay(payload) {
  payload = payload || {};
  const date = payload.date;
  if (!isLocalDateString(date)) throw typedError("INVALID_REQUEST", "date must be a valid YYYY-MM-DD date", false);
  const includeDone = valueOf(payload, "includeDone", "include_done") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const clearDueDay = valueOf(payload, "clearDueDay", "clear_due_day") === true;
  const dryRun = valueOf(payload, "dryRun", "dry_run") === true;
  const tasks = await getTasksBySource(includeArchived ? "all" : "active");
  const entries = [];
  for (const task of tasks) {
    if (!includeDone && task.isDone) continue;
    if (!includeArchived && task.isArchived) continue;
    const schedule = taskSchedule(task);
    let patch = {};
    // Without clearDueDay a timed task keeps the day, as day-only work, as the
    // app's unschedule-but-leave-in-day does; with it the task is unscheduled.
    if (schedule.kind === "timed" && schedule.day === date) patch = scheduleWrite({ dueWithTime: null, dueDay: clearDueDay ? null : date }, task);
    if (clearDueDay && task.dueDay === date) patch.dueDay = null;
    if (Object.keys(patch).length > 0) entries.push({ taskId: task.id, patch });
  }
  const out = await applyPatches(entries, new Map(tasks.map((task) => [task.id, task])), dryRun);
  return { ...out, date, changedCount: out.results.filter((result) => result.success).length };
}

// hostTimeZone names the zone calendar dates are read in.
function hostTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
}

async function taskScheduleHealth(payload) {
  payload = payload || {};
  // Without a date, the report is for the app's logical Today: a timed task
  // counts on the day it falls on after the day-start offset. An explicit
  // date is a calendar day in the host time zone.
  const day = payload.date == null ? await getDayContext() : null;
  const date = day ? day.todayStr : payload.date;
  const offset = day ? day.startOfNextDayDiffMs : 0;
  if (!isLocalDateString(date)) throw typedError("INVALID_REQUEST", "date must be a valid YYYY-MM-DD date", false);
  const staleBeforeDate = valueOf(payload, "staleBeforeDate", "stale_before_date") || date;
  if (!isLocalDateString(staleBeforeDate)) throw typedError("INVALID_REQUEST", "staleBeforeDate must be a valid YYYY-MM-DD date", false);
  const includeDone = valueOf(payload, "includeDone", "include_done") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const oversizedNotesThreshold = Number(valueOf(payload, "oversizedNotesThreshold", "oversized_notes_threshold") ?? 4000);
  const tasks = (await getTasksBySource(includeArchived ? "all" : "active"))
    .filter((task) => (includeDone || !task.isDone) && (includeArchived || !task.isArchived));
  const scheduled = tasks.map((task) => {
    const schedule = taskSchedule(task);
    return { task, schedule: { ...schedule, day: scheduleDayIn(schedule, offset) } };
  });
  const where = (test) => scheduled.filter(({ task, schedule }) => test(schedule, task)).map(({ task }) => task);

  const lists = {
    // Timed and day-only work scheduled on date.
    plannedToday: where((s) => s.day === date),
    overdue: where((s) => s.day != null && s.day < date),
    unscheduledActiveTopLevel: where((s, task) => !task.parentId && s.kind === "none"),
    stalePlanned: where((s) => s.kind === "timed" && s.day < staleBeforeDate),
    // staleDue keeps its meaning: any valid dueDay before the cutoff.
    staleDue: where((s, task) => isLocalDateString(task.dueDay) && task.dueDay < staleBeforeDate),
    missingEstimate: tasks.filter((task) => !Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) <= 0),
    oversizedNotes: tasks.filter((task) => String(task.notes || "").length > oversizedNotesThreshold),
    recurringGenerated: tasks.filter((task) => !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle)),
    suspiciousDatesOrEstimates: tasks.filter(hasSuspiciousDatesOrEstimates),
  };
  const compactLists = Object.fromEntries(Object.entries(lists).map(([key, value]) => [key, value.map(compactTaskSummary)]));
  const counts = Object.fromEntries(Object.entries(compactLists).map(([key, value]) => [key, value.length]));
  const basis = day ? { dayBasis: "logical", dayContext: day } : { dayBasis: "calendar" };
  return { date, staleBeforeDate, ...basis, timeZone: hostTimeZone(), counts, tasks: compactLists };
}

async function taskScheduleRange(payload) {
  payload = payload || {};
  const startDate = valueOf(payload, "startDate", "start_date");
  const endDate = valueOf(payload, "endDate", "end_date") || startDate;
  if (!isLocalDateString(startDate)) throw typedError("INVALID_REQUEST", "startDate must be a valid YYYY-MM-DD date", false);
  if (!isLocalDateString(endDate)) throw typedError("INVALID_REQUEST", "endDate must be a valid YYYY-MM-DD date", false);
  if (endDate < startDate) throw typedError("INVALID_REQUEST", "endDate must not be before startDate", false);
  const includeDone = valueOf(payload, "includeDone", "include_done") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  // An explicit range is calendar days in the host time zone, not logical days.
  const entries = (await getTasksBySource(includeArchived ? "all" : "active"))
    .filter((task) => (includeDone || !task.isDone) && (includeArchived || !task.isArchived))
    .map((task) => ({ task, schedule: taskSchedule(task) }))
    .filter(({ schedule }) => schedule.day != null && schedule.day >= startDate && schedule.day <= endDate)
    // Each day lists timed work by time, then day-only work by title.
    .sort((a, b) => compareScheduled(a, b));
  const byDate = new Map(localDateRange(startDate, endDate).map((date) => [date, []]));
  for (const { task, schedule } of entries) {
    if (byDate.has(schedule.day)) byDate.get(schedule.day).push(compactTaskSummary(task));
  }
  return { startDate, endDate, dayBasis: "calendar", timeZone: hostTimeZone(), days: [...byDate.entries()].map(([date, dayTasks]) => ({ date, tasks: dayTasks })) };
}

function compareScheduled(a, b) {
  const timedFirst = (a.schedule.at == null) - (b.schedule.at == null);
  return timedFirst || Number(a.schedule.at || 0) - Number(b.schedule.at || 0) || String(a.task.title || "").localeCompare(String(b.task.title || ""));
}

async function taskFindStaleSchedule(payload) {
  payload = payload || {};
  const beforeDate = valueOf(payload, "beforeDate", "before_date");
  if (!isLocalDateString(beforeDate)) throw typedError("INVALID_REQUEST", "beforeDate must be YYYY-MM-DD", false);
  const includeDueDay = valueOf(payload, "includeDueDay", "include_due_day") !== false;
  const includePlannedAt = valueOf(payload, "includePlannedAt", "include_planned_at") !== false;
  const includeCompleted = valueOf(payload, "includeCompleted", "include_completed") === true;
  const includeArchived = valueOf(payload, "includeArchived", "include_archived") === true;
  const tasks = (await getTasksBySource(includeArchived ? "all" : "active"))
    .filter((task) => (includeCompleted || !task.isDone) && (includeArchived || !task.isArchived))
    .map((task) => {
      const schedule = taskSchedule(task);
      const stale = schedule.day != null && schedule.day < beforeDate;
      return { task, staleDueDay: includeDueDay && isLocalDateString(task.dueDay) && task.dueDay < beforeDate, stalePlannedAt: includePlannedAt && stale && schedule.kind === "timed" };
    })
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
    .filter((task) => taskSchedule(task).kind === "none")
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

async function taskMakePlannedAt(payload) {
  payload = payload || {};
  const date = payload.date;
  const time = payload.time || "09:00";
  const timezone = payload.timezone && payload.timezone !== "local" ? payload.timezone : hostTimeZone();
  if (!isLocalDateString(date)) throw typedError("INVALID_REQUEST", "date must be a valid YYYY-MM-DD date", false);
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw typedError("INVALID_REQUEST", "time must be HH:MM from 00:00 to 23:59", false);
  const resolved = resolveZonedWallTime(date, time, timezone, payload.disambiguation);
  const out = { plannedAt: resolved.ms, iso: new Date(resolved.ms).toISOString(), timezone };
  if (resolved.ambiguous) out.ambiguous = resolved.ambiguous;
  return out;
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// freeSlot is the first start at or after the day's next free time that does
// not overlap a busy interval.
function freeSlot(day, estimateMs) {
  let start = day.nextMs;
  for (let moved = true; moved; ) {
    moved = false;
    for (const [busyStart, busyEnd] of day.busy) {
      if (start < busyEnd && start + estimateMs > busyStart) {
        start = busyEnd;
        moved = true;
      }
    }
  }
  return start;
}

// nextDayStartMs is when the calendar day after date starts in timezone.
function nextDayStartMs(date, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  // Midnight itself can fall in a DST gap in a few zones; take the first
  // minute that exists.
  for (const time of ["00:00", "01:00", "02:00"]) {
    try {
      return resolveZonedWallTime(nextDate, time, timezone, "earlier").ms;
    } catch (_err) {
      // try the next hour
    }
  }
  throw typedError("INVALID_REQUEST", `cannot find the start of ${nextDate} in ${timezone}`, false);
}

function weekdayOf(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return WEEKDAY_KEYS[new Date(year, month - 1, day).getDay()];
}

// taskAutoSchedule places unscheduled leaf tasks into free capacity on the
// given calendar days, as timed work starting at workStart in timezone. Work
// already scheduled on a day counts against its capacity, and new work never
// overlaps a timed task. A parent whose subtasks are candidates is skipped,
// so parent and subtask estimates are not counted twice. Every day is a
// working day unless workingDays names others. Dry run by default.
async function taskAutoSchedule(payload) {
  payload = payload || {};
  const startDate = payload.startDate || payload.start_date;
  const endDate = payload.endDate || payload.end_date || startDate;
  if (!isLocalDateString(startDate)) throw typedError("INVALID_REQUEST", "startDate must be a valid YYYY-MM-DD date", false);
  if (!isLocalDateString(endDate)) throw typedError("INVALID_REQUEST", "endDate must be a valid YYYY-MM-DD date", false);
  if (endDate < startDate) throw typedError("INVALID_REQUEST", "endDate must not be before startDate", false);
  const timezone = payload.timezone && payload.timezone !== "local" ? payload.timezone : hostTimeZone();
  const capacityMs = Math.max(1, Number(valueOf(payload, "capacityPerDayMinutes", "capacity_per_day_minutes") || 240)) * 60000;
  const defaultEstimateMs = Math.max(1, Number(valueOf(payload, "defaultEstimateMinutes", "default_estimate_minutes") || 30)) * 60000;
  const workStart = payload.workStart || payload.work_start || payload.workHours?.[0]?.start || "09:00";
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(workStart)) throw typedError("INVALID_REQUEST", "workStart must be HH:MM", false);
  const workingDays = valueOf(payload, "workingDays", "working_days") || WEEKDAY_KEYS.slice(1).concat("sun");
  if (!Array.isArray(workingDays) || workingDays.some((day) => !WEEKDAY_KEYS.includes(day))) {
    throw typedError("INVALID_REQUEST", `workingDays must list days out of ${WEEKDAY_KEYS.join(", ")}`, false);
  }
  const dryRun = valueOf(payload, "dryRun", "dry_run") !== false || valueOf(payload, "confirmApply", "confirm_apply") !== true;

  const tasks = (await getTasksBySource("active")).filter((task) => !task.isDone && !task.isArchived);
  const parentIds = new Set(tasks.filter((task) => task.parentId).map((task) => task.parentId));
  const isLeaf = (task) => !parentIds.has(task.id) && !(Array.isArray(task.subTaskIds) && task.subTaskIds.length > 0);
  const estimateOf = (task) => (Number(task.timeEstimate) > 0 ? Number(task.timeEstimate) : defaultEstimateMs);

  // Each working day runs from workStart until the next calendar day starts.
  // A day whose workStart the clocks skip (a DST gap) is left out.
  const days = [];
  const skippedDays = [];
  for (const date of localDateRange(startDate, endDate).filter((d) => workingDays.includes(weekdayOf(d)))) {
    let startMs;
    try {
      startMs = resolveZonedWallTime(date, workStart, timezone, "earlier").ms;
    } catch (err) {
      if (err.code !== "INVALID_REQUEST" || /time zone/.test(err.message)) throw err;
      skippedDays.push({ date, reason: "workStart does not exist on this day (daylight saving change)" });
      continue;
    }
    days.push({ date, existingMs: 0, plannedMs: 0, busy: [], nextMs: startMs, endMs: nextDayStartMs(date, timezone) });
  }
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  // Existing allocations: scheduled leaf tasks on each day.
  for (const task of tasks) {
    const schedule = taskSchedule(task);
    const day = schedule.day && dayByDate.get(schedule.day);
    if (!day || !isLeaf(task)) continue;
    day.existingMs += estimateOf(task);
    if (schedule.kind === "timed") day.busy.push([schedule.at, schedule.at + estimateOf(task)]);
  }

  const topLevelOnly = !!payload.rules?.topLevelOnly;
  const candidates = tasks
    .filter((task) => taskSchedule(task).kind === "none")
    .filter((task) => !topLevelOnly || !task.parentId)
    .filter((task) => !payload.includeProjectIds?.length || payload.includeProjectIds.includes(task.projectId))
    .filter((task) => !payload.excludeProjectIds?.length || !payload.excludeProjectIds.includes(task.projectId))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  const candidateIds = new Set(candidates.map((task) => task.id));
  const updates = [];
  const skipped = [];
  for (const task of candidates) {
    // A parent's estimate is the sum of its subtasks': schedule a parent only
    // when topLevelOnly asks for it and none of its subtasks is scheduled.
    if (!isLeaf(task)) {
      const children = tasks.filter((child) => child.parentId === task.id);
      if (!topLevelOnly || children.some((child) => taskSchedule(child).kind !== "none")) {
        const reason = children.some((child) => candidateIds.has(child.id)) && !topLevelOnly ? "subtasks_scheduled_instead" : "has_scheduled_subtasks";
        skipped.push({ ...compactTaskSummary(task), reason });
        continue;
      }
    }
    const estimateMs = estimateOf(task);
    let placed = null;
    for (const day of days) {
      if (day.existingMs + day.plannedMs + estimateMs > capacityMs) continue;
      const start = freeSlot(day, estimateMs);
      if (start + estimateMs > day.endMs) continue;
      placed = { day, start };
      break;
    }
    if (!placed) {
      skipped.push({ ...compactTaskSummary(task), reason: "capacity_exhausted" });
      continue;
    }
    const { day, start } = placed;
    day.busy.push([start, start + estimateMs]);
    day.nextMs = start + estimateMs;
    day.plannedMs += estimateMs;
    const patch = scheduleWrite({ dueWithTime: start }, task);
    updates.push({ taskId: task.id, dueWithTime: start, plannedAt: start, date: day.date, changes: Object.entries(patch).map(([field, after]) => ({ field, before: task[field] ?? null, after })) });
  }
  const result = {
    dryRun,
    startDate,
    endDate,
    timezone,
    workingDays,
    capacity: days.map((day) => ({ date: day.date, existingMs: day.existingMs, plannedMs: day.plannedMs, capacityMs })),
    skippedDays,
    updates,
    scheduledCount: updates.length,
    skipped,
  };
  if (!dryRun) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const entries = updates.map((update) => ({ taskId: update.taskId, patch: scheduleWrite({ dueWithTime: update.dueWithTime }, byId.get(update.taskId)) }));
    result.results = (await applyPatches(entries, byId, false)).results;
  }
  return result;
}

async function taskCompactNotes(payload) {
  payload = payload || {};
  const taskId = valueOf(payload, "taskId", "task_id");
  const replacementNotes = valueOf(payload, "replacementNotes", "replacement_notes");
  if (!taskId) throw typedError("INVALID_REQUEST", "taskId is required", false);
  if (typeof replacementNotes !== "string") throw typedError("INVALID_REQUEST", "replacementNotes is required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  const dryRun = valueOf(payload, "dryRun", "dry_run") !== false || valueOf(payload, "confirmApply", "confirm_apply") !== true;
  const result = {
    dryRun,
    taskId,
    title: task.title,
    oldLength: String(task.notes || "").length,
    newLength: replacementNotes.length,
    delta: replacementNotes.length - String(task.notes || "").length,
  };
  if (!dryRun) {
    await PluginAPI.updateTask(taskId, { notes: replacementNotes });
    result.updated = true;
  }
  return result;
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

function zonedWallTimeToMs(dateStr, timeStr, timezone) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  if (!timezone || timezone === "local" || timezone === Intl.DateTimeFormat().resolvedOptions().timeZone) {
    return new Date(year, month - 1, day, hour, minute).getTime();
  }
  const targetWall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetWall;
  for (let i = 0; i < 4; i++) {
    const parts = zonedDateParts(new Date(guess), timezone);
    const actualWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const delta = targetWall - actualWall;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

// zonedOffsetMs is the zone's UTC offset at instant ms, to the minute.
function zonedOffsetMs(ms, timezone) {
  const p = zonedDateParts(new Date(ms), timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000;
}

// resolveZonedWallTime finds the instant a wall-clock time names in a zone.
// A time skipped by a spring-forward change does not exist and is refused.
// A time repeated by a fall-back change is ambiguous: disambiguation
// "earlier" or "later" picks one; without it the request is refused.
function resolveZonedWallTime(dateStr, timeStr, timezone, disambiguation) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let candidates;
  try {
    const offsets = new Set([-86400000, 0, 86400000].map((shift) => zonedOffsetMs(wall + shift, timezone)));
    candidates = [...new Set([...offsets].map((offset) => wall - offset))]
      .filter((ms) => {
        const p = zonedDateParts(new Date(ms), timezone);
        return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
      })
      .sort((a, b) => a - b);
  } catch (_err) {
    throw typedError("INVALID_REQUEST", `timezone ${timezone} is not a known IANA time zone`, false);
  }
  if (candidates.length === 0) {
    throw typedError("INVALID_REQUEST", `${dateStr} ${timeStr} does not exist in ${timezone}: the clocks skip it`, false, { date: dateStr, time: timeStr, timezone });
  }
  if (candidates.length === 1) return { ms: candidates[0], ambiguous: null };
  const [earlier, later] = [candidates[0], candidates[candidates.length - 1]];
  if (disambiguation === "earlier" || disambiguation === "later") {
    return { ms: disambiguation === "earlier" ? earlier : later, ambiguous: { earlier, later, chosen: disambiguation } };
  }
  throw typedError("INVALID_REQUEST", `${dateStr} ${timeStr} happens twice in ${timezone}; pass disambiguation "earlier" or "later"`, false, { earlier, later, timezone });
}

function zonedDateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

module.exports = {
  hostTimeZone,
  resolveZonedWallTime,
  taskAutoSchedule,
  taskClearScheduleForDay,
  taskCompactNotes,
  taskFindStaleSchedule,
  taskFindUnscheduledActive,
  taskMakePlannedAt,
  taskScheduleHealth,
  taskScheduleRange,
};
