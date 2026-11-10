const catalog = require("../tool-catalog.json");
const { typedError } = require("../errors");

function requirePluginFunction(name) {
  if (typeof PluginAPI[name] !== "function") {
    throw typedError("UNSUPPORTED_ACTION", `PluginAPI.${name} is not available in this Super Productivity runtime`, false);
  }
  return PluginAPI[name].bind(PluginAPI);
}

// Habit history: full simple-counter models with per-day values. Stopwatch
// values are milliseconds; click counters and countdown reminders are counts.
// Mirrors habitHistory in internal/bridge/habits.go.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function habitHistory(counters, payload) {
  const counterId = payload?.counterId || payload?.counter_id || payload?.id;
  const startDate = payload?.startDate || payload?.start_date;
  const endDate = payload?.endDate || payload?.end_date;
  for (const [name, value] of [["startDate", startDate], ["endDate", endDate]]) {
    if (value != null && !validDay(value)) throw typedError("INVALID_REQUEST", `${name} must be a valid YYYY-MM-DD date`, false);
  }
  if (startDate && endDate && endDate < startDate) throw typedError("INVALID_REQUEST", "endDate must not be before startDate", false);
  let list = Array.isArray(counters) ? counters : [];
  if (counterId) {
    list = list.filter((counter) => counter && counter.id === counterId);
    if (list.length === 0) throw typedError("SIMPLE_COUNTER_NOT_FOUND", `Simple counter ${counterId} not found`, false);
  }
  return list.map((counter) => ({
    id: counter.id,
    title: counter.title,
    type: counter.type,
    unit: counter.type === "StopWatch" ? "ms" : "count",
    isEnabled: !!counter.isEnabled,
    isOn: !!counter.isOn,
    days: Object.entries(counter.countOnDay || {})
      .filter(([date]) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value: Number(value) })),
  }));
}

const exported = {
  "notification.show": async (payload) => {
    const message = payload?.message || "";
    const rawType = String(payload?.type || "info").toUpperCase();
    const typeMap = {
      SUCCESS: "SUCCESS",
      INFO: "INFO",
      WARNING: "WARNING",
      ERROR: "ERROR",
    };
    const type = typeMap[rawType] || "INFO";
    if (typeof PluginAPI.showSnack === "function") {
      // v20 SnackCfg reads msg; message is kept for older hosts.
      await PluginAPI.showSnack({ msg: message, message, type });
    } else {
      console.log(`[notification:${type}] ${message}`);
    }
    return { shown: true, type };
  },
  "notification.notify": async (payload) => {
    const notify = requirePluginFunction("notify");
    const message = payload?.message || "";
    const title = payload?.title || "Super Productivity MCP";
    await notify({ title, message });
    return { notified: true };
  },
  "counter.list": async () => ({ counters: await requirePluginFunction("getAllCounters")() }),
  "counter.get": async (payload) => {
    const id = payload?.id || payload?.counterId || payload?.counter_id;
    if (!id) throw typedError("INVALID_REQUEST", "counter id is required", false);
    return { id, value: await requirePluginFunction("getCounter")(id) };
  },
  "counter.set": async (payload) => {
    const id = payload?.id || payload?.counterId || payload?.counter_id;
    if (!id) throw typedError("INVALID_REQUEST", "counter id is required", false);
    const value = Number(payload?.value ?? 0);
    await requirePluginFunction("setCounter")(id, value);
    return { id, value };
  },
  "counter.increment": async (payload) => {
    const id = payload?.id || payload?.counterId || payload?.counter_id;
    if (!id) throw typedError("INVALID_REQUEST", "counter id is required", false);
    const delta = Number(payload?.delta ?? 1);
    return { id, value: await requirePluginFunction("incrementCounter")(id, delta) };
  },
  "counter.decrement": async (payload) => {
    const id = payload?.id || payload?.counterId || payload?.counter_id;
    if (!id) throw typedError("INVALID_REQUEST", "counter id is required", false);
    const delta = Number(payload?.delta ?? 1);
    return { id, value: await requirePluginFunction("decrementCounter")(id, delta) };
  },
  "counter.delete": async (payload) => {
    const id = payload?.id || payload?.counterId || payload?.counter_id;
    if (!id) throw typedError("INVALID_REQUEST", "counter id is required", false);
    await requirePluginFunction("deleteCounter")(id);
    return { id, deleted: true };
  },
  "counter.history": async (payload) => {
    // Without getAllSimpleCounters the MCP server reads Local REST instead.
    const counters = await requirePluginFunction("getAllSimpleCounters")();
    return { counters: habitHistory(counters, payload), via: "plugin" };
  },
  "counter.setDay": async () => {
    // The plugin API can set only today's scalar counter value; the MCP
    // server sets a day through Local REST PUT /simple-counters/:id/value.
    throw typedError("UNSUPPORTED_ACTION", "Setting a habit's value for a day needs Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN). Nothing was changed.", false);
  },
  "bridge.health": async () => ({ ok: true, message: "bridge alive" }),
  "bridge.checkConnection": async () => ({ ok: true, message: "bridge alive" }),
  "bridge.status": async () => ({
    isReady: true,
    pluginVersion: "0.1.0",
    protocolVersion: catalog.protocolVersion,
  }),
  "bridge.debugDirectories": async () => ({ ok: true, dirs: global.mcpBridgeDirs || {} }),
  "bridge.capabilities": async () => ({
    supportedActions: catalog.tools.map((t) => t.action),
    pluginVersion: "0.1.0",
    protocolVersion: catalog.protocolVersion,
  }),
  // Focus state is read by the MCP server from Local REST GET /focus; the
  // plugin API has no focus read.
  "focus.state": async () => {
    throw typedError("UNSUPPORTED_ACTION", "Reading focus state needs Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN)", false);
  },
};

Object.defineProperty(exported, "habitHistory", { value: habitHistory, enumerable: false });

module.exports = exported;
