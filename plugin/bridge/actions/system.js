const catalog = require("../tool-catalog.json");

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
  "bridge.health": async () => ({ ok: true, message: "bridge alive" }),
  "bridge.capabilities": async () => ({
    supportedActions: catalog.tools.map((t) => t.action),
    pluginVersion: "0.1.0",
    protocolVersion: catalog.protocolVersion,
  }),
};
