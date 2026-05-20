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

test("notification.notify uses PluginAPI.notify when available", async () => {
  let received;
  global.PluginAPI = {
    notify: async (payload) => {
      received = payload;
    },
  };

  assert.deepEqual(await systemActions["notification.notify"]({ title: "Title", message: "Body" }), { notified: true });
  assert.deepEqual(received, { title: "Title", message: "Body" });
});

test("notification.notify reports unsupported runtime", async () => {
  global.PluginAPI = {};

  await assert.rejects(systemActions["notification.notify"]({ message: "Body" }), (err) => err.code === "UNSUPPORTED_ACTION");
});

test("counter actions wrap PluginAPI counters", async () => {
  const counters = new Map([["focus", 2]]);
  global.PluginAPI = {
    getAllCounters: async () => Object.fromEntries(counters),
    getCounter: async (id) => counters.get(id) ?? 0,
    setCounter: async (id, value) => counters.set(id, value),
    incrementCounter: async (id, delta) => {
      counters.set(id, (counters.get(id) ?? 0) + delta);
      return counters.get(id);
    },
    decrementCounter: async (id, delta) => {
      counters.set(id, (counters.get(id) ?? 0) - delta);
      return counters.get(id);
    },
    deleteCounter: async (id) => counters.delete(id),
  };

  assert.deepEqual(await systemActions["counter.list"]({}), { counters: { focus: 2 } });
  assert.deepEqual(await systemActions["counter.get"]({ id: "focus" }), { id: "focus", value: 2 });
  assert.deepEqual(await systemActions["counter.set"]({ counter_id: "focus", value: 5 }), { id: "focus", value: 5 });
  assert.deepEqual(await systemActions["counter.increment"]({ id: "focus", delta: 3 }), { id: "focus", value: 8 });
  assert.deepEqual(await systemActions["counter.decrement"]({ id: "focus", delta: 2 }), { id: "focus", value: 6 });
  assert.deepEqual(await systemActions["counter.delete"]({ id: "focus" }), { id: "focus", deleted: true });
});

test("counter actions validate id and unsupported APIs", async () => {
  global.PluginAPI = {};

  await assert.rejects(systemActions["counter.get"]({}), (err) => err.code === "INVALID_REQUEST");
  await assert.rejects(systemActions["counter.list"]({}), (err) => err.code === "UNSUPPORTED_ACTION");
});
