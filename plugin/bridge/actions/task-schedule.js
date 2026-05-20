const { typedError } = require("../errors");
const { dayRangeMs, findTask, getTasksBySource, isLocalDateString, localDateStr, valueOf } = require("./task-common");
const { compactTaskSummary, hasSuspiciousDatesOrEstimates } = require("./task-shape");
const { taskBulkUpdateCore } = require("./task-mutate");

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

async function taskMakePlannedAt(payload) {
  payload = payload || {};
  const date = payload.date;
  const time = payload.time || "09:00";
  const timezone = payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  if (!isLocalDateString(date)) throw typedError("INVALID_REQUEST", "date must be YYYY-MM-DD", false);
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw typedError("INVALID_REQUEST", "time must be HH:MM", false);
  const plannedAt = zonedWallTimeToMs(date, time, timezone);
  return { plannedAt, iso: new Date(plannedAt).toISOString(), timezone };
}

async function taskAutoSchedule(payload) {
  payload = payload || {};
  const startDate = payload.startDate || payload.start_date;
  const endDate = payload.endDate || payload.end_date || startDate;
  if (!isLocalDateString(startDate)) throw typedError("INVALID_REQUEST", "startDate must be YYYY-MM-DD", false);
  if (!isLocalDateString(endDate)) throw typedError("INVALID_REQUEST", "endDate must be YYYY-MM-DD", false);
  const timezone = payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const capacityMs = Math.max(1, Number(valueOf(payload, "capacityPerDayMinutes", "capacity_per_day_minutes") || 240)) * 60000;
  const defaultEstimateMs = Math.max(1, Number(valueOf(payload, "defaultEstimateMinutes", "default_estimate_minutes") || 30)) * 60000;
  const workStart = payload.workStart || payload.work_start || payload.workHours?.[0]?.start || "09:00";
  const dryRun = valueOf(payload, "dryRun", "dry_run") !== false || valueOf(payload, "confirmApply", "confirm_apply") !== true;
  const candidates = (await getTasksBySource("active"))
    .filter((task) => !task.isDone && !task.isArchived && task.plannedAt == null)
    .filter((task) => !payload.rules?.topLevelOnly || !task.parentId)
    .filter((task) => !payload.includeProjectIds?.length || payload.includeProjectIds.includes(task.projectId))
    .filter((task) => !payload.excludeProjectIds?.length || !payload.excludeProjectIds.includes(task.projectId))
    .sort((a, b) => String(a.dueDay || "9999-99-99").localeCompare(String(b.dueDay || "9999-99-99")) || String(a.title || "").localeCompare(String(b.title || "")));
  const days = localDateRange(startDate, endDate).map((date) => ({ date, usedMs: 0, nextMs: zonedWallTimeToMs(date, workStart, timezone) }));
  const updates = [];
  const skipped = [];
  for (const task of candidates) {
    const estimateMs = Number(task.timeEstimate) > 0 ? Number(task.timeEstimate) : defaultEstimateMs;
    const day = days.find((candidate) => candidate.usedMs + estimateMs <= capacityMs);
    if (!day) {
      skipped.push({ ...compactTaskSummary(task), reason: "capacity_exhausted" });
      continue;
    }
    updates.push({ taskId: task.id, plannedAt: day.nextMs });
    day.usedMs += estimateMs;
    day.nextMs += estimateMs;
  }
  const result = { dryRun, startDate, endDate, timezone, updates, scheduledCount: updates.length, skipped };
  if (!dryRun) result.results = (await taskBulkUpdateCore({ updates, dryRun: false }, ["plannedAt"])).results;
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
  taskAutoSchedule,
  taskClearScheduleForDay,
  taskCompactNotes,
  taskFindStaleSchedule,
  taskFindUnscheduledActive,
  taskMakePlannedAt,
  taskScheduleHealth,
  taskScheduleRange,
};
