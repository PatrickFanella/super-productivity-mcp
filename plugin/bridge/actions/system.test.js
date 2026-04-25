const test = require("node:test");
const assert = require("node:assert/strict");

const systemActions = require("./system");

test("bridge.capabilities exposes canonical actions", async () => {
  const out = await systemActions["bridge.capabilities"]({});
  assert.ok(Array.isArray(out.supportedActions));
  assert.ok(out.supportedActions.includes("task.create"));
  assert.ok(out.supportedActions.includes("bridge.health"));
});
