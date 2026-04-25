// Thin entrypoint; real bridge implementation lives in plugin/bridge
(async () => {
  try {
    const bridgeModule = require("./plugin/bridge/plugin");
    await bridgeModule.startBridge();
  } catch (error) {
    console.error("Failed to start MCP Bridge v2", error);
  }
})();
