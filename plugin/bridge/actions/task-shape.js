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

function isLocalDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayRangeMs(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  return [start, start + 86400000];
}

module.exports = {
  compactTaskSummary,
  dayRangeMs,
  hasSuspiciousDatesOrEstimates,
  isLocalDateString,
  localDateStr,
  pickFields,
  sortAndPageTasks,
  valueOf,
  withSyntheticTaskFields,
};
