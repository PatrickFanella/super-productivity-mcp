const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pluginPath = path.join(__dirname, "..", "plugin.js");
const catalogPath = path.join(__dirname, "..", "internal", "catalog", "tools.json");

test("root plugin entrypoint is browser-safe", () => {
  const src = fs.readFileSync(pluginPath, "utf8");
  const runtimeSrc = src.replace(/`[^`]*`/gs, "``");
  assert.doesNotMatch(runtimeSrc, /require\s*\(/);
  assert.doesNotMatch(runtimeSrc, /process\s*\./);
  assert.match(src, /setTimeout\s*\(\s*init\s*,\s*500\s*\)/);
});

test("manifest enables iframe plugin loading", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert.equal(manifest.iFrame, true);
  assert.equal(manifest.isSkipMenuEntry, true);
});

test("node execution failures do not mark bridge ready", async () => {
  const src = fs.readFileSync(pluginPath, "utf8");
  const logs = [];
  const errors = [];
  const timers = [];
  const context = {
    PluginAPI: {
      executeNodeScript: async () => ({ success: false, error: "boom" }),
    },
    window: {},
    console: {
      log: (...args) => logs.push(args),
      error: (...args) => errors.push(args),
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => {
      const p = Promise.resolve().then(fn);
      timers.push(p);
      return timers.length;
    },
    Date,
    Promise,
    Object,
    Array,
    String,
    Number,
    Math,
  };

  vm.runInNewContext(src, context);
  for (let i = 0; i < 25; i++) {
    await Promise.all(timers.splice(0));
  }

  assert.equal(logs.some((args) => String(args[0]).includes("MCP Bridge v2 ready")), false);
  assert.ok(errors.some((args) => String(args[0]).includes("MCP Bridge init failed after all retries")));
  assert.equal(context.window.mcpBridge, undefined);
});

test("root plugin handlers match canonical catalog actions", () => {
  const src = fs.readFileSync(pluginPath, "utf8");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const catalogActions = catalog.tools.map((tool) => tool.action).sort();
  const handlersMatch = src.match(/const handlers = \{([\s\S]*?)\n  \};/);
  assert.ok(handlersMatch, "handlers object not found");
  const handlerActions = [...handlersMatch[1].matchAll(/\n\s{4}'([^']+)':/g)].map((m) => m[1]).sort();
  assert.deepEqual(handlerActions, catalogActions);
});

test("root plugin capabilities derive supported actions from handlers", () => {
  const src = fs.readFileSync(pluginPath, "utf8");
  assert.doesNotMatch(src, /const supportedActions\s*=\s*\[/);
  assert.match(src, /Object\.keys\(handlers\)/);
});
