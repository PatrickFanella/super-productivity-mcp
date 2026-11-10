// Behaviour adopted from Super Productivity's first-party MCP: explicit
// scheduling and recurrence on create, literal titles, title-only search,
// truncation flags, id aliases and a status action.
const test = require("node:test");
const assert = require("node:assert/strict");

const handlers = require("./index");

function pluginWithTasks(tasks, extra = {}) {
  const added = [];
  const dispatched = [];
  global.PluginAPI = {
    getAllTags: async () => [{ id: "tag-1", title: "shopping" }],
    getAllProjects: async () => [{ id: "proj-1", title: "Work" }],
    getTasks: async () => tasks,
    addTask: async (data) => {
      added.push(data);
      const id = `task-${added.length}`;
      tasks.push({ id, ...data });
      return id;
    },
    dispatchAction: async (action) => dispatched.push(action),
    ...extra,
  };
  return { added, dispatched };
}

test("task.create literal keeps short syntax in the title", async () => {
  const { added } = pluginWithTasks([]);
  await handlers["task.create"]({ title: "Buy milk #shopping +work @tomorrow 30m", literal: true });
  assert.equal(added[0].title, "Buy milk #shopping +work @tomorrow 30m");
  assert.deepEqual(added[0].tagIds, []);
  assert.equal(added[0].projectId, undefined);
  assert.equal(added[0].dueDay, undefined);
  assert.equal(added[0].timeEstimate, 0);
});

test("task.create schedules dueDate and dueTime in local time", async () => {
  const updated = [];
  const { added } = pluginWithTasks([], { updateTask: async (id, data) => updated.push({ id, data }) });
  const out = await handlers["task.create"]({ title: "Call", dueDate: "2026-12-03", dueTime: "09:30" });
  // PluginAPI.addTask has no dueWithTime, so the time is set right after creation.
  assert.equal(added[0].dueDay, undefined);
  assert.equal(added[0].isIgnoreShortSyntax, true);
  assert.deepEqual(updated, [{ id: out.taskId, data: { dueWithTime: new Date(2026, 11, 3, 9, 30).getTime(), dueDay: null } }]);
  assert.equal(out.scheduleError, undefined);
});

test("task.create reports a failed time write next to the created id", async () => {
  const { added } = pluginWithTasks([], { updateTask: async () => { throw new Error("boom"); } });
  const out = await handlers["task.create"]({ title: "Call", dueDate: "2026-12-03", dueTime: "09:30" });
  assert.equal(added.length, 1);
  assert.equal(out.taskId, "task-1");
  assert.equal(out.scheduleError.message, "boom");
});

test("task.create refuses a skipped or repeated local time before adding", async () => {
  process.env.TZ = "America/Chicago";
  try {
    const { added } = pluginWithTasks([]);
    await assert.rejects(handlers["task.create"]({ title: "x", dueDate: "2026-03-08", dueTime: "02:30" }), { code: "INVALID_REQUEST" });
    await assert.rejects(handlers["task.create"]({ title: "x", dueDate: "2026-11-01", dueTime: "01:30" }), { code: "INVALID_REQUEST" });
    assert.equal(added.length, 0);
  } finally {
    delete process.env.TZ;
  }
});

test("task.createWithSubtasks parses titles once and lets subtasks inherit project and tags", async () => {
  const { added } = pluginWithTasks([], { updateTask: async () => {} });
  await handlers["task.createWithSubtasks"]({
    title: "Launch #shopping +wor",
    subtasks: [{ title: "Copy #shopping 30m", tagIds: ["tag-x"] }],
  });
  assert.equal(added[0].projectId, "proj-1");
  assert.deepEqual(added[0].tagIds, ["tag-1"]);
  assert.equal(added[1].parentId, "task-1");
  // The app gives a subtask its parent's project and no tags.
  assert.equal("projectId" in added[1], false);
  assert.equal("tagIds" in added[1], false);
  assert.equal(added[1].title, "Copy #shopping");
  assert.equal(added[1].timeEstimate, 30 * 60 * 1000);
  assert.ok(added.every((data) => data.isIgnoreShortSyntax === true));
});

test("task.create explicit dueDate overrides a parsed @date and its time", async () => {
  const { added } = pluginWithTasks([]);
  await handlers["task.create"]({ title: "Call @tomorrow 15:00", dueDate: "2026-12-03" });
  assert.equal(added[0].dueDay, "2026-12-03");
  assert.equal(added[0].dueWithTime, undefined);
});

test("task.create rejects invalid scheduling before adding a task", async () => {
  const { added } = pluginWithTasks([]);
  await assert.rejects(handlers["task.create"]({ title: "x", dueTime: "09:00" }), { code: "INVALID_REQUEST", message: "dueTime requires dueDate" });
  await assert.rejects(handlers["task.create"]({ title: "x", dueDate: "2026-02-30" }), { code: "INVALID_REQUEST" });
  await assert.rejects(handlers["task.create"]({ title: "x", dueDate: "2026-02-03", dueTime: "24:00" }), { code: "INVALID_REQUEST" });
  await assert.rejects(handlers["task.create"]({ title: "x", repeat: { cycle: "daily", weekdays: ["mon"] } }), {
    code: "INVALID_REQUEST",
    message: "repeat.weekdays needs cycle weekly",
  });
  await assert.rejects(handlers["task.create"]({ title: "x", repeat: { cycle: "hourly" } }), { code: "INVALID_REQUEST" });
  await assert.rejects(handlers["task.create"]({ title: "x", repeat: { cycle: "daily", every: 100 } }), { code: "INVALID_REQUEST" });
  assert.equal(added.length, 0);
});

test("task.create repeat creates a weekly recurrence on the given weekdays", async () => {
  const { dispatched } = pluginWithTasks([]);
  const out = await handlers["task.create"]({
    title: "Standup",
    dueDate: "2026-12-07",
    dueTime: "10:00",
    repeat: { cycle: "weekly", every: 2, weekdays: ["mon", "thu"] },
  });
  assert.equal(out.taskId, "task-1");
  assert.match(out.repeatCfgId, /^mcp_repeat_/);
  const cfg = dispatched[0].taskRepeatCfg;
  assert.equal(dispatched[0].taskId, "task-1");
  assert.equal(cfg.repeatCycle, "WEEKLY");
  assert.equal(cfg.repeatEvery, 2);
  assert.equal(cfg.quickSetting, "CUSTOM");
  assert.equal(cfg.startDate, "2026-12-07");
  assert.equal(cfg.startTime, "10:00");
  assert.equal(cfg.monday, true);
  assert.equal(cfg.thursday, true);
  assert.equal(cfg.tuesday, false);
});

test("task.create weekly repeat defaults to the start day's weekday", async () => {
  const { dispatched } = pluginWithTasks([]);
  // 2026-12-06 is a Sunday.
  await handlers["task.create"]({ title: "Plan week", dueDate: "2026-12-06", repeat: { cycle: "weekly" } });
  const cfg = dispatched[0].taskRepeatCfg;
  assert.equal(cfg.sunday, true);
  assert.equal(cfg.monday, false);
});

test("task.create daily repeat every day uses the DAILY quick setting", async () => {
  const { dispatched } = pluginWithTasks([]);
  await handlers["task.create"]({ title: "Water plants", repeat: { cycle: "daily" } });
  assert.equal(dispatched[0].taskRepeatCfg.quickSetting, "DAILY");
});

test("task.create reports a recurrence failure next to the created task id", async () => {
  const { added } = pluginWithTasks([], {
    dispatchAction: async () => {
      throw Object.assign(new Error("store rejected"), { code: "DISPATCH_FAILED" });
    },
  });
  const out = await handlers["task.create"]({ title: "x", repeat: { cycle: "daily" } });
  assert.equal(added.length, 1);
  assert.deepEqual(out, { taskId: "task-1", recurrenceError: { code: "DISPATCH_FAILED", message: "store rejected" } });
});

test("task.create repeat needs dispatchAction and checks before adding", async () => {
  const { added } = pluginWithTasks([], { dispatchAction: undefined });
  await assert.rejects(handlers["task.create"]({ title: "x", repeat: { cycle: "daily" } }), { code: "UNSUPPORTED_ACTION" });
  assert.equal(added.length, 0);
});

test("task.list accepts query, honours searchNotes:false and reports truncation", async () => {
  pluginWithTasks([
    { id: "a", title: "Alpha report", notes: "", isDone: false },
    { id: "b", title: "Beta", notes: "contains report", isDone: false },
    { id: "c", title: "Gamma report", notes: "", isDone: false },
  ]);
  const withNotes = await handlers["task.list"]({ query: "report" });
  assert.deepEqual(withNotes.tasks.map((t) => t.id), ["a", "b", "c"]);
  assert.equal(withNotes.truncated, false);

  const titleOnly = await handlers["task.list"]({ query: "report", searchNotes: false });
  assert.deepEqual(titleOnly.tasks.map((t) => t.id), ["a", "c"]);

  const limited = await handlers["task.list"]({ search: "report", limit: 2 });
  assert.equal(limited.tasks.length, 2);
  assert.equal(limited.truncated, true);

  const lastPage = await handlers["task.list"]({ search: "report", limit: 2, offset: 2 });
  assert.equal(lastPage.tasks.length, 1);
  assert.equal(lastPage.truncated, false);
});

test("task.get accepts id as an alias for taskId", async () => {
  pluginWithTasks([{ id: "a", title: "Alpha" }]);
  assert.equal((await handlers["task.get"]({ id: "a" })).task.title, "Alpha");
  assert.equal((await handlers["task.get"]({ taskId: "a" })).task.title, "Alpha");
  await assert.rejects(handlers["task.get"]({}), { code: "INVALID_REQUEST" });
});

test("bridge.status reports readiness without task data", async () => {
  const out = await handlers["bridge.status"]();
  assert.equal(out.isReady, true);
  assert.equal(out.protocolVersion, "2.0");
  assert.equal(out.tasks, undefined);
});
