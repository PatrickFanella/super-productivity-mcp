#!/usr/bin/env node
const fs = require("node:fs");

global.PluginAPI = {
  getTasks: async () => [
    { id: "fixture-task", title: "Fixture task", isDone: false, tagIds: [], plannedAt: Date.now() },
  ],
  getAllProjects: async () => [],
  getAllTags: async () => [],
  executeNodeScript: async ({ script, args }) => {
    try {
      const fn = new Function("args", "require", script);
      return { success: true, result: fn(args || [], require) };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },
};

const { startBridge } = require("../../plugin/bridge/plugin");

startBridge()
  .then(() => {
    const readyPath = process.env.SP_MCP_FIXTURE_READY;
    if (readyPath) fs.writeFileSync(readyPath, "ready");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
