#!/usr/bin/env node
const fs = require("node:fs");

const executeNodeScript = async ({ script, args }) => {
  try {
    const fn = new Function("args", "require", script);
    return { success: true, result: fn(args || [], require) };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
};

if (process.env.SP_MCP_FIXTURE === "v20") {
  // The synthetic stock-v20 inventory from test/fixtures/upstream/v20.
  process.env.TZ = "America/Chicago";
  const { createPluginApi } = require("../fixtures/upstream/v20/harness");
  global.PluginAPI = { ...createPluginApi().api, executeNodeScript };
} else {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "fixture-task", title: "Fixture task", isDone: false, tagIds: [], plannedAt: Date.now() },
    ],
    getAllProjects: async () => [],
    getAllTags: async () => [],
    executeNodeScript,
  };
}

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
