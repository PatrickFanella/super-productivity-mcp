const test = require("node:test");
const assert = require("node:assert/strict");

const taskActions = require("./task");

function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("task.create parses tag, project, due date, and estimate short syntax", async () => {
  let received;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  global.PluginAPI = {
    getAllTags: async () => [{ id: "tag-1", title: "shopping" }],
    getAllProjects: async () => [{ id: "proj-1", title: "Work" }],
    addTask: async (data) => {
      received = data;
      return "task-1";
    },
  };

  const out = await taskActions["task.create"]({ title: "Buy milk #shopping +wor @tomorrow 30m" });

  assert.deepEqual(out, { taskId: "task-1" });
  assert.equal(received.title, "Buy milk");
  assert.deepEqual(received.tagIds, ["tag-1"]);
  assert.equal(received.projectId, "proj-1");
  assert.equal(received.dueDay, localDateStr(tomorrow));
  assert.equal(received.timeEstimate, 30 * 60 * 1000);
});

test("task.create parses spent/estimate syntax and preserves explicit ids", async () => {
  let received;
  global.PluginAPI = {
    getAllTags: async () => [{ id: "tag-1", title: "shopping" }],
    getAllProjects: async () => [{ id: "proj-1", title: "Work" }],
    addTask: async (data) => {
      received = data;
      return "task-1";
    },
  };

  await taskActions["task.create"]({
    title: "Research #shopping +work 1h/2h",
    projectId: "explicit-project",
    tagIds: ["explicit-tag"],
  });

  assert.equal(received.title, "Research");
  assert.equal(received.projectId, "explicit-project");
  assert.deepEqual(received.tagIds, ["explicit-tag", "tag-1"]);
  assert.equal(received.timeSpent, 60 * 60 * 1000);
  assert.equal(received.timeEstimate, 2 * 60 * 60 * 1000);
});

test("task.createWithSubtasks creates parent then child tasks", async () => {
  const calls = [];
  global.PluginAPI = {
    getAllTags: async () => [{ id: "tag-1", title: "launch" }],
    getAllProjects: async () => [{ id: "proj-1", title: "Work" }],
    addTask: async (data) => {
      calls.push(data);
      return calls.length === 1 ? "parent-1" : `child-${calls.length - 1}`;
    },
  };

  const out = await taskActions["task.createWithSubtasks"]({
    title: "Launch blog #launch +wor 2h",
    notes: "parent notes",
    subtasks: [
      { title: "Draft copy 30m", notes: "child notes" },
      { title: "Publish" },
    ],
  });

  assert.deepEqual(out, { parentId: "parent-1", subtaskIds: ["child-1", "child-2"] });
  assert.equal(calls[0].title, "Launch blog");
  assert.equal(calls[0].projectId, "proj-1");
  assert.deepEqual(calls[0].tagIds, ["tag-1"]);
  assert.equal(calls[0].timeEstimate, 2 * 60 * 60 * 1000);
  assert.deepEqual(calls.slice(1).map((call) => call.parentId), ["parent-1", "parent-1"]);
  assert.equal(calls[1].title, "Draft copy");
  assert.equal(calls[1].notes, "child notes");
  assert.equal(calls[1].timeEstimate, 30 * 60 * 1000);
});

test("task.start starts requested task and stops existing tracked task", async () => {
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [
      { id: "old", title: "Old", currentTimestamp: 123, isDone: false },
      { id: "new", title: "New", currentTimestamp: null, isDone: false },
    ],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const out = await taskActions["task.start"]({ taskId: "new" });

  assert.deepEqual(out, { started: true });
  assert.equal(updates[0].taskId, "old");
  assert.deepEqual(updates[0].data, { currentTimestamp: null });
  assert.equal(updates[1].taskId, "new");
  assert.equal(typeof updates[1].data.currentTimestamp, "number");
});

test("task.start rejects completed tasks", async () => {
  global.PluginAPI = {
    getTasks: async () => [{ id: "done", title: "Done", isDone: true }],
  };

  await assert.rejects(taskActions["task.start"]({ taskId: "done" }), (err) => err.code === "TASK_DONE");
});

test("task.stop clears current timestamp and is idempotent", async () => {
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [{ id: "active", currentTimestamp: 123, isDone: false }],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const out = await taskActions["task.stop"]({});

  assert.deepEqual(out, { stopped: true });
  assert.deepEqual(updates, [{ taskId: "active", data: { currentTimestamp: null } }]);

  global.PluginAPI = { getTasks: async () => [] };
  assert.deepEqual(await taskActions["task.stop"]({}), { stopped: false });
});

test("task.current returns currently tracked task summary", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "idle", currentTimestamp: null },
      { id: "active", title: "Active", currentTimestamp: 123, isDone: false, projectId: "p1", parentId: null, tagIds: ["t1"], dueDay: "2026-05-13" },
    ],
  };

  const out = await taskActions["task.current"]({});

  assert.deepEqual(out.task, {
    id: "active",
    title: "Active",
    isDone: false,
    projectId: "p1",
    parentId: null,
    tagIds: ["t1"],
    dueDay: "2026-05-13",
  });

  global.PluginAPI = { getTasks: async () => [] };
  assert.deepEqual(await taskActions["task.current"]({}), { task: null });
});

test("task.bulkComplete completes existing tasks with partial results", async () => {
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [{ id: "a" }, { id: "b" }],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const out = await taskActions["task.bulkComplete"]({ taskIds: ["a", "missing", "b"] });

  assert.deepEqual(out.results.map((r) => ({ id: r.id, success: r.success })), [
    { id: "a", success: true },
    { id: "missing", success: false },
    { id: "b", success: true },
  ]);
  assert.deepEqual(updates.map((u) => u.taskId), ["a", "b"]);
  assert.equal(updates[0].data.isDone, true);
  assert.equal(typeof updates[0].data.doneOn, "number");
});

test("task.bulkUpdate maps snake case fields and reports partial failure", async () => {
  const updates = [];
  global.PluginAPI = {
    updateTask: async (taskId, data) => {
      if (taskId === "bad") throw new Error("nope");
      updates.push({ taskId, data });
    },
  };

  const out = await taskActions["task.bulkUpdate"]({
    updates: [
      { task_id: "a", due_day: "2026-05-14", planned_at: null, time_estimate: 60000, tag_ids: ["t1"] },
      { task_id: "bad", title: "Break" },
    ],
  });

  assert.deepEqual(updates, [{ taskId: "a", data: { dueDay: "2026-05-14", plannedAt: null, timeEstimate: 60000, tagIds: ["t1"] } }]);
  assert.deepEqual(out.results.map((r) => ({ id: r.id, success: r.success })), [
    { id: "a", success: true },
    { id: "bad", success: false },
  ]);
});

test("task.bulkUpdate dry-run reports diffs without mutating", async () => {
  let mutated = false;
  global.PluginAPI = {
    getTasks: async () => [{ id: "a", title: "A", plannedAt: 1000, dueDay: "2026-05-13" }],
    updateTask: async () => {
      mutated = true;
    },
  };

  const out = await taskActions["task.bulkUpdate"]({
    dryRun: true,
    updates: [{ taskId: "a", plannedAt: 2000, dueDay: null }],
  });

  assert.equal(out.dryRun, true);
  assert.equal(mutated, false);
  assert.deepEqual(out.results[0].changes, [
    { field: "dueDay", before: "2026-05-13", after: null },
    { field: "plannedAt", before: 1000, after: 2000 },
  ]);

  const missing = await taskActions["task.bulkUpdate"]({ dryRun: true, updates: [{ taskId: "missing", plannedAt: 3000 }] });
  assert.equal(missing.results[0].success, false);
  assert.match(missing.results[0].error, /not found/);
});

test("task.bulkReschedule only updates schedule fields", async () => {
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [{ id: "a", title: "A" }],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const out = await taskActions["task.bulkReschedule"]({
    updates: [
      { task_id: "a", title: "ignored", planned_at: 123, time_estimate: 60000 },
      { task_id: "b", title: "no schedule field" },
    ],
  });

  assert.deepEqual(updates, [{ taskId: "a", data: { plannedAt: 123, timeEstimate: 60000 } }]);
  assert.equal(out.results[0].success, true);
  assert.deepEqual(out.results[0].ignoredFields, ["title"]);
  assert.equal(out.results[1].success, false);
});

test("task.clearScheduleForDay supports dry-run and updates", async () => {
  const plannedAt = new Date(2026, 4, 14, 9).getTime();
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [
      { id: "planned", title: "Planned", plannedAt, dueDay: "2026-05-14", isDone: false },
      { id: "done", title: "Done", plannedAt, dueDay: "2026-05-14", isDone: true },
      { id: "other-day", title: "Other", plannedAt: new Date(2026, 4, 15).getTime(), isDone: false },
    ],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const dry = await taskActions["task.clearScheduleForDay"]({ date: "2026-05-14", clear_due_day: true, dry_run: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.changedCount, 1);
  assert.deepEqual(updates, []);

  const changed = await taskActions["task.clearScheduleForDay"]({ date: "2026-05-14", clearDueDay: true });
  assert.equal(changed.changedCount, 1);
  assert.deepEqual(updates, [{ taskId: "planned", data: { plannedAt: null, dueDay: null } }]);
});

test("task.scheduleHealth returns cleanup counts and concise lists", async () => {
  const plannedAt = new Date(2026, 4, 14, 8).getTime();
  const stalePlanned = new Date(2026, 4, 1).getTime();
  global.PluginAPI = {
    getTasks: async () => [
      { id: "planned", title: "Planned", plannedAt, dueDay: "2026-05-14", timeEstimate: 60000, notes: "ok" },
      { id: "overdue", title: "Overdue", dueDay: "2026-05-13", timeEstimate: 0, notes: "x".repeat(20) },
      { id: "unscheduled", title: "Unscheduled", parentId: null, timeEstimate: 60000 },
      { id: "child", title: "Child", parentId: "unscheduled", timeEstimate: 60000 },
      { id: "stale", title: "Stale", plannedAt: stalePlanned, dueDay: "2026-05-01", timeEstimate: 60000, repeatCfgId: "r1" },
      { id: "bad", title: "Bad", dueDay: "not-a-date", timeEstimate: 400 * 86400000 },
    ],
  };

  const out = await taskActions["task.scheduleHealth"]({ date: "2026-05-14", stale_before_date: "2026-05-10", oversized_notes_threshold: 10 });

  assert.equal(out.counts.plannedToday, 1);
  assert.equal(out.counts.overdue, 2);
  assert.equal(out.counts.unscheduledActiveTopLevel, 1);
  assert.equal(out.counts.stalePlanned, 1);
  assert.equal(out.counts.staleDue, 1);
  assert.equal(out.counts.missingEstimate, 1);
  assert.equal(out.counts.oversizedNotes, 1);
  assert.equal(out.counts.recurringGenerated, 1);
  assert.equal(out.counts.suspiciousDatesOrEstimates, 1);
  assert.deepEqual(out.tasks.plannedToday[0].id, "planned");
});

test("task.planToday plans and unplans tasks via plannedAt", async () => {
  const updates = [];
  global.PluginAPI = {
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const planned = await taskActions["task.planToday"]({ taskIds: ["a", "b"] });
  assert.deepEqual(planned.results.map((r) => ({ id: r.id, success: r.success })), [
    { id: "a", success: true },
    { id: "b", success: true },
  ]);
  assert.equal(typeof updates[0].data.plannedAt, "number");

  updates.length = 0;
  await taskActions["task.planToday"]({ task_ids: ["a"], unplan: true });
  assert.deepEqual(updates, [{ taskId: "a", data: { plannedAt: null } }]);
});

test("task.addTag adds tag without replacing existing tags", async () => {
  let received;
  global.PluginAPI = {
    getTasks: async () => [{ id: "task-1", tagIds: ["existing"] }],
    updateTask: async (taskId, data) => {
      received = { taskId, data };
    },
  };

  assert.deepEqual(await taskActions["task.addTag"]({ task_id: "task-1", tag_id: "new" }), { added: true });
  assert.deepEqual(received, { taskId: "task-1", data: { tagIds: ["existing", "new"] } });

  received = undefined;
  assert.deepEqual(await taskActions["task.addTag"]({ taskId: "task-1", tagId: "existing" }), { added: false });
  assert.equal(received, undefined);
});

test("task.removeTag removes existing tag and errors when absent", async () => {
  let received;
  global.PluginAPI = {
    getTasks: async () => [{ id: "task-1", tagIds: ["keep", "drop"] }],
    updateTask: async (taskId, data) => {
      received = { taskId, data };
    },
  };

  assert.deepEqual(await taskActions["task.removeTag"]({ taskId: "task-1", tagId: "drop" }), { removed: true });
  assert.deepEqual(received, { taskId: "task-1", data: { tagIds: ["keep"] } });

  await assert.rejects(taskActions["task.removeTag"]({ taskId: "task-1", tagId: "absent" }), (err) => err.code === "TAG_NOT_ON_TASK");
});

test("task.moveToProject moves top-level task and rejects subtasks", async () => {
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [
      { id: "top", projectId: "old", parentId: null },
      { id: "child", projectId: "old", parentId: "parent" },
    ],
    getAllProjects: async () => [{ id: "new" }],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  assert.deepEqual(await taskActions["task.moveToProject"]({ task_id: "top", project_id: "new" }), { moved: true });
  assert.deepEqual(updates, [{ taskId: "top", data: { projectId: "new" } }]);

  await assert.rejects(taskActions["task.moveToProject"]({ taskId: "child", projectId: "new" }), (err) => err.code === "TASK_IS_SUBTASK");
  await assert.rejects(taskActions["task.moveToProject"]({ taskId: "top", projectId: "missing" }), (err) => err.code === "PROJECT_NOT_FOUND");
});

test("task.delete deletes existing task and errors when missing", async () => {
  const deleted = [];
  global.PluginAPI = {
    getTasks: async () => [{ id: "task-1" }],
    deleteTask: async (taskId) => deleted.push(taskId),
  };

  assert.deepEqual(await taskActions["task.delete"]({ task_id: "task-1" }), { deleted: true });
  assert.deepEqual(deleted, ["task-1"]);

  await assert.rejects(taskActions["task.delete"]({ taskId: "missing" }), (err) => err.code === "TASK_NOT_FOUND");
});

test("task.delete reports unsupported runtime when delete API is absent", async () => {
  global.PluginAPI = {
    getTasks: async () => [{ id: "task-1" }],
  };

  await assert.rejects(taskActions["task.delete"]({ taskId: "task-1" }), (err) => err.code === "UNSUPPORTED_ACTION");
});

test("task.archive errors unless true archive or explicit fallback is available", async () => {
  const oldUrl = process.env.SP_LOCAL_REST_URL;
  delete process.env.SP_LOCAL_REST_URL;
  delete process.env.SUPER_PRODUCTIVITY_REST_URL;
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [{ id: "task-1" }],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  await assert.rejects(taskActions["task.archive"]({ taskId: "task-1" }), (err) => err.code === "UNSUPPORTED_ACTION");

  const out = await taskActions["task.archive"]({ task_id: "task-1", allow_done_fallback: true });
  assert.equal(out.archived, false);
  assert.equal(updates[0].taskId, "task-1");
  assert.equal(updates[0].data.isDone, true);

  if (oldUrl === undefined) delete process.env.SP_LOCAL_REST_URL;
  else process.env.SP_LOCAL_REST_URL = oldUrl;
});

test("task.archive uses configured local REST archive endpoint", async () => {
  const oldUrl = process.env.SP_LOCAL_REST_URL;
  const oldToken = process.env.SP_LOCAL_REST_TOKEN;
  const oldFetch = global.fetch;
  process.env.SP_LOCAL_REST_URL = "http://127.0.0.1:3219/api";
  process.env.SP_LOCAL_REST_TOKEN = "token-1";
  let received;
  global.PluginAPI = { getTasks: async () => [{ id: "task-1" }] };
  global.fetch = async (url, options) => {
    received = { url, options };
    return { ok: true, status: 200, text: async () => "" };
  };

  assert.deepEqual(await taskActions["task.archive"]({ taskId: "task-1" }), { archived: true, via: "localRest" });
  assert.equal(received.url, "http://127.0.0.1:3219/api/tasks/task-1/archive");
  assert.equal(received.options.method, "POST");
  assert.equal(received.options.headers.Authorization, "Bearer token-1");

  if (oldUrl === undefined) delete process.env.SP_LOCAL_REST_URL;
  else process.env.SP_LOCAL_REST_URL = oldUrl;
  if (oldToken === undefined) delete process.env.SP_LOCAL_REST_TOKEN;
  else process.env.SP_LOCAL_REST_TOKEN = oldToken;
  global.fetch = oldFetch;
});

test("task.restore requires and uses configured local REST endpoint", async () => {
  const oldUrl = process.env.SP_LOCAL_REST_URL;
  const oldFetch = global.fetch;
  delete process.env.SP_LOCAL_REST_URL;
  delete process.env.SUPER_PRODUCTIVITY_REST_URL;

  await assert.rejects(taskActions["task.restore"]({ task_id: "task-1" }), (err) => err.code === "UNSUPPORTED_ACTION");

  process.env.SP_LOCAL_REST_URL = "http://127.0.0.1:3219/api/";
  let received;
  global.fetch = async (url, options) => {
    received = { url, options };
    return { ok: true, status: 200, text: async () => "" };
  };

  assert.deepEqual(await taskActions["task.restore"]({ taskId: "task-1" }), { restored: true, via: "localRest" });
  assert.equal(received.url, "http://127.0.0.1:3219/api/tasks/task-1/restore");
  assert.equal(received.options.method, "POST");

  if (oldUrl === undefined) delete process.env.SP_LOCAL_REST_URL;
  else process.env.SP_LOCAL_REST_URL = oldUrl;
  global.fetch = oldFetch;
});

test("task start/stop/current prefer configured local REST", async () => {
  const oldUrl = process.env.SP_LOCAL_REST_URL;
  const oldFetch = global.fetch;
  process.env.SP_LOCAL_REST_URL = "http://127.0.0.1:3219";
  const calls = [];
  global.PluginAPI = {
    getTasks: async () => {
      throw new Error("Plugin fallback should not be used");
    },
  };
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    return {
      ok: true,
      status: 200,
      text: async () => (url.endsWith("/task-control/current") ? JSON.stringify({ task: { id: "active", title: "Active" } }) : ""),
    };
  };

  assert.deepEqual(await taskActions["task.start"]({ task_id: "task-1" }), { started: true, via: "localRest" });
  assert.deepEqual(await taskActions["task.stop"]({}), { stopped: true, via: "localRest" });
  assert.deepEqual(await taskActions["task.current"]({}), { task: { id: "active", title: "Active" }, via: "localRest" });
  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:3219/tasks/task-1/start", method: "POST" },
    { url: "http://127.0.0.1:3219/task-control/stop", method: "POST" },
    { url: "http://127.0.0.1:3219/task-control/current", method: "GET" },
  ]);

  if (oldUrl === undefined) delete process.env.SP_LOCAL_REST_URL;
  else process.env.SP_LOCAL_REST_URL = oldUrl;
  global.fetch = oldFetch;
});

test("task.reorder supports snake aliases, parent context, and validation", async () => {
  const calls = [];
  global.PluginAPI = {
    getTasks: async () => [
      { id: "a", parentId: "parent-1", projectId: "proj-1", tagIds: ["tag-1"] },
      { id: "b", parentId: "parent-1", projectId: "proj-1", tagIds: ["tag-1"] },
      { id: "wrong", parentId: "other", projectId: "proj-1", tagIds: [] },
    ],
    reorderTasks: async (taskIds, contextId, contextType) => calls.push({ taskIds, contextId, contextType }),
  };

  assert.deepEqual(await taskActions["task.reorder"]({ task_ids: ["b", "a"], context_id: "parent-1", context_type: "parent" }), { reordered: true });
  assert.deepEqual(calls, [{ taskIds: ["b", "a"], contextId: "parent-1", contextType: "task" }]);

  assert.deepEqual(await taskActions["task.reorderTasks"]({ taskIds: ["a", "b"], contextId: "tag-1", contextType: "tag" }), { reordered: true });
  await assert.rejects(taskActions["task.reorder"]({ taskIds: ["wrong"], contextId: "parent-1", contextType: "parent" }), (err) => err.code === "TASK_CONTEXT_MISMATCH");
});

test("task.worklog summarizes tracked time within a date range", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "a", title: "A", projectId: "p1", tagIds: ["t1"], timeSpentOnDay: { "2026-05-12": 60000, "2026-05-13": 120000 } },
      { id: "b", title: "B", projectId: "p2", tagIds: [], timeSpentOnDay: [{ date: "2026-05-13", timeSpent: 30000 }] },
      { id: "c", title: "C", timeSpentOnDay: { "2026-05-14": 999 } },
    ],
  };

  const out = await taskActions["task.worklog"]({ start_date: "2026-05-13", end_date: "2026-05-13" });

  assert.equal(out.totalMs, 150000);
  assert.deepEqual(out.entries, [
    { date: "2026-05-13", taskId: "a", title: "A", projectId: "p1", tagIds: ["t1"], timeMs: 120000 },
    { date: "2026-05-13", taskId: "b", title: "B", projectId: "p2", tagIds: [], timeMs: 30000 },
  ]);
});

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

test("task.list supports overdue and planned-for-today filters", async () => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const plannedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  global.PluginAPI = {
    getTasks: async () => [
      { id: "overdue", isDone: false, dueDay: yesterdayStr },
      { id: "today", isDone: false, dueDay: todayStr, plannedAt },
      { id: "done-overdue", isDone: true, dueDay: yesterdayStr },
    ],
  };

  const overdue = await taskActions["task.list"]({ includeDone: false, overdue: true });
  assert.deepEqual(overdue.tasks.map((t) => t.id), ["overdue"]);

  const planned = await taskActions["task.list"]({ includeDone: false, plannedForToday: true });
  assert.deepEqual(planned.tasks.map((t) => t.id), ["today"]);
});

test("task.list supports parity filters and search", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      {
        id: "match",
        title: "Launch blog",
        notes: "write announcement",
        projectId: "proj-1",
        tagIds: ["tag-1"],
        isDone: false,
        isArchived: false,
        parentId: null,
      },
      {
        id: "wrong-project",
        title: "Launch side quest",
        notes: "write announcement",
        projectId: "proj-2",
        tagIds: ["tag-1"],
        isDone: false,
        isArchived: false,
        parentId: null,
      },
      {
        id: "child",
        title: "Launch child",
        notes: "write announcement",
        projectId: "proj-1",
        tagIds: ["tag-1"],
        isDone: false,
        isArchived: false,
        parentId: "match",
      },
    ],
  };

  const out = await taskActions["task.list"]({
    projectId: "proj-1",
    tagId: "tag-1",
    isDone: false,
    isArchived: false,
    search: "announcement",
    parents_only: true,
  });

  assert.deepEqual(out.tasks.map((t) => t.id), ["match"]);
});

test("task.list supports recurring-only and field selection", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "rec", title: "Recurring", repeatCfgId: "repeat-1", notes: "keep", tagIds: ["tag-1"] },
      { id: "plain", title: "Plain", notes: "drop", tagIds: ["tag-1"] },
    ],
  };

  const out = await taskActions["task.list"]({ recurring_only: true, fields: ["id", "title"] });

  assert.deepEqual(out.tasks, [{ id: "rec", title: "Recurring" }]);
});

test("task.list supports archived source, synthetic fields, sorting and paging", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "parent", title: "Parent", projectId: "p1", notes: "12345", subTaskIds: ["child"], created: 2 },
      { id: "child", title: "Child", parentId: "parent", projectId: "p1", notes: "", created: 1 },
    ],
    getArchivedTasks: async () => [{ id: "arch", title: "Archived", projectId: "p2", isDone: true, created: 3 }],
    getAllProjects: async () => [{ id: "p1", title: "Work" }, { id: "p2", title: "Done" }],
  };

  const out = await taskActions["task.list"]({
    source: "all",
    includeSynthetic: true,
    sort_by: "created",
    sort_direction: "desc",
    limit: 2,
    fields: ["id", "projectTitle", "parentTitle", "noteLength", "subtaskCount", "isArchived"],
  });

  assert.deepEqual(out.tasks, [
    { id: "arch", projectTitle: "Done", parentTitle: undefined, noteLength: 0, subtaskCount: 0, isArchived: true },
    { id: "parent", projectTitle: "Work", parentTitle: undefined, noteLength: 5, subtaskCount: 1, isArchived: false },
  ]);
});

test("task.scheduleRange groups planned tasks by local date", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "a", title: "A", plannedAt: new Date(2026, 4, 14, 9).getTime(), isDone: false },
      { id: "b", title: "B", plannedAt: new Date(2026, 4, 15, 9).getTime(), isDone: false },
      { id: "done", title: "Done", plannedAt: new Date(2026, 4, 14, 10).getTime(), isDone: true },
    ],
  };

  const out = await taskActions["task.scheduleRange"]({ start_date: "2026-05-14", end_date: "2026-05-15" });

  assert.deepEqual(out.days.map((day) => ({ date: day.date, ids: day.tasks.map((task) => task.id) })), [
    { date: "2026-05-14", ids: ["a"] },
    { date: "2026-05-15", ids: ["b"] },
  ]);
});

test("task.findStaleSchedule finds stale due and planned tasks", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "due", title: "Due", dueDay: "2026-05-01", isDone: false },
      { id: "planned", title: "Planned", plannedAt: new Date(2026, 4, 1).getTime(), isDone: false },
      { id: "fresh", title: "Fresh", dueDay: "2026-05-20", plannedAt: new Date(2026, 4, 20).getTime(), isDone: false },
    ],
  };

  const out = await taskActions["task.findStaleSchedule"]({ before_date: "2026-05-10" });

  assert.deepEqual(out.tasks.map((task) => ({ id: task.id, staleDueDay: task.staleDueDay, stalePlannedAt: task.stalePlannedAt })), [
    { id: "due", staleDueDay: true, stalePlannedAt: false },
    { id: "planned", staleDueDay: false, stalePlannedAt: true },
  ]);
});

test("task.findUnscheduledActive filters top-level active tasks", async () => {
  global.PluginAPI = {
    getTasks: async () => [
      { id: "match", title: "Match", projectId: "p1", tagIds: ["t1"], timeEstimate: 0, isDone: false },
      { id: "child", title: "Child", parentId: "match", projectId: "p1", tagIds: ["t1"], timeEstimate: 0, isDone: false },
      { id: "planned", title: "Planned", projectId: "p1", plannedAt: 1, isDone: false },
      { id: "done", title: "Done", projectId: "p1", isDone: true },
      { id: "excluded", title: "Excluded", projectId: "p2", isDone: false },
    ],
  };

  const out = await taskActions["task.findUnscheduledActive"]({ include_project_ids: ["p1"], include_tag_ids: ["t1"], missing_estimate_only: true });

  assert.deepEqual(out.tasks.map((task) => task.id), ["match"]);
});

test("task.makePlannedAt converts local date and time", async () => {
  const out = await taskActions["task.makePlannedAt"]({ date: "2026-05-14", time: "09:30", timezone: "local" });

  assert.equal(out.plannedAt, new Date(2026, 4, 14, 9, 30).getTime());
  assert.equal(out.timezone, "local");
  assert.match(out.iso, /^2026-/);
});

test("task.autoSchedule dry-runs by default and applies with confirmation", async () => {
  const updates = [];
  global.PluginAPI = {
    getTasks: async () => [
      { id: "a", title: "A", timeEstimate: 30 * 60000, isDone: false },
      { id: "b", title: "B", timeEstimate: 45 * 60000, isDone: false },
      { id: "planned", title: "Planned", plannedAt: 123, isDone: false },
    ],
    updateTask: async (taskId, data) => updates.push({ taskId, data }),
  };

  const dry = await taskActions["task.autoSchedule"]({ start_date: "2026-05-14", end_date: "2026-05-14", capacity_per_day_minutes: 60, timezone: "local" });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.updates.map((update) => update.taskId), ["a"]);
  assert.deepEqual(dry.skipped.map((task) => task.id), ["b"]);
  assert.deepEqual(updates, []);

  const applied = await taskActions["task.autoSchedule"]({ startDate: "2026-05-14", capacityPerDayMinutes: 60, timezone: "local", dryRun: false, confirmApply: true });
  assert.equal(applied.dryRun, false);
  assert.equal(applied.results[0].success, true);
  assert.equal(updates[0].taskId, "a");
  assert.equal(typeof updates[0].data.plannedAt, "number");
});

test("task.update forwards dueDay and plannedAt", async () => {
  let received;
  global.PluginAPI = {
    updateTask: async (_id, updates) => {
      received = updates;
    },
  };

  await taskActions["task.update"]({ taskId: "1", dueDay: "2026-05-13", plannedAt: 1778630400000 });
  assert.deepEqual(received, { dueDay: "2026-05-13", plannedAt: 1778630400000 });
});

test("task.get throws typed TASK_NOT_FOUND", async () => {
  global.PluginAPI = { getTasks: async () => [] };
  await assert.rejects(taskActions["task.get"]({ taskId: "missing" }), (err) => err.code === "TASK_NOT_FOUND");
});
