const test = require("node:test");
const assert = require("node:assert/strict");

const systemActions = require("./system");

test("bridge.capabilities exposes canonical actions", async () => {
  const out = await systemActions["bridge.capabilities"]({});
  assert.ok(Array.isArray(out.supportedActions));
  assert.ok(out.supportedActions.includes("task.create"));
  assert.ok(out.supportedActions.includes("bridge.health"));
});

test("bridge aliases expose connection and directory diagnostics", async () => {
  global.mcpBridgeDirs = { base: "/tmp/sp", inbox: "/tmp/sp/inbox" };

  assert.deepEqual(await systemActions["bridge.checkConnection"]({}), { ok: true, message: "bridge alive" });
  const out = await systemActions["bridge.debugDirectories"]({});
  assert.equal(out.ok, true);
  assert.deepEqual(out.dirs, global.mcpBridgeDirs);
});
