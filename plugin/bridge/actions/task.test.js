const test = require("node:test");
const assert = require("node:assert/strict");

const taskActions = require("./task");

test("task.list includeDone=false filters completed tasks", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "1", isDone: false },
      { id: "2", isDone: true },
    ],
  };
  const out = await taskActions["task.list"]({ includeDone: false });
  assert.equal(out.tasks.length, 1);
  assert.equal(out.tasks[0].id, "1");
});

test("task.get throws typed TASK_NOT_FOUND", async () => {
  global.PluginAPI = { getTasks: async () => [] };
  await assert.rejects(taskActions["task.get"]({ taskId: "missing" }), (err) => err.code === "TASK_NOT_FOUND");
});
