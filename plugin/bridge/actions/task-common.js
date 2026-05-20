const { dayRangeMs, isLocalDateString, localDateStr, valueOf } = require("./task-shape");

async function findTask(taskId) {
  const tasks = await PluginAPI.getTasks();
  return tasks.find((task) => task.id === taskId) || null;
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

function mergeUnique(first, second) {
  return [...new Set([...(first || []), ...(second || [])])];
}

function startOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

module.exports = {
  dayRangeMs,
  findTask,
  getTasksBySource,
  isLocalDateString,
  localDateStr,
  mergeUnique,
  startOfTodayMs,
  valueOf,
};
