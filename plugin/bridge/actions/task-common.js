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

// getDayContext returns the app's logical day. It is read on every call, so a
// day change is picked up without a hook. Hosts without
// PluginAPI.getDayContext fall back to the host clock's calendar day with no
// day-start offset; source says which was used.
async function getDayContext() {
  if (typeof PluginAPI.getDayContext === "function") {
    const ctx = await PluginAPI.getDayContext();
    if (ctx && isLocalDateString(ctx.todayStr)) {
      return { todayStr: ctx.todayStr, startOfNextDayDiffMs: Number(ctx.startOfNextDayDiffMs) || 0, source: "app" };
    }
  }
  return { todayStr: localDateStr(new Date()), startOfNextDayDiffMs: 0, source: "host-clock" };
}

function startOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

module.exports = {
  dayRangeMs,
  findTask,
  getDayContext,
  getTasksBySource,
  isLocalDateString,
  localDateStr,
  mergeUnique,
  startOfTodayMs,
  valueOf,
};
