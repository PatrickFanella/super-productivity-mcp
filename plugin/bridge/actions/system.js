const catalog = require("../tool-catalog.json");
const { typedError } = require("../errors");

function requirePluginFunction(name) {
  if (typeof PluginAPI[name] !== "function") {
    throw typedError("UNSUPPORTED_ACTION", `PluginAPI.${name} is not available in this Super Productivity runtime`, false);
  }
  return PluginAPI[name].bind(PluginAPI);
}

module.exports = {
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
      await PluginAPI.showSnack({ message, type });
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
  "bridge.health": async () => ({ ok: true, message: "bridge alive" }),
  "bridge.checkConnection": async () => ({ ok: true, message: "bridge alive" }),
  "bridge.debugDirectories": async () => ({ ok: true, dirs: global.mcpBridgeDirs || {} }),
  "bridge.capabilities": async () => ({
    supportedActions: catalog.tools.map((t) => t.action),
    pluginVersion: "0.1.0",
    protocolVersion: catalog.protocolVersion,
  }),
};
