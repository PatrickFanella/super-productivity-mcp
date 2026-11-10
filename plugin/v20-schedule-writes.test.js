// Canonical v20 schedule writes (#21), checked in the modular bridge and the
// packaged plugin.js against the same fixtures: both must send identical
// writes.
process.env.TZ = "America/Chicago";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const fixtureDir = path.join(__dirname, "..", "test", "fixtures", "upstream", "v20");
const { loadFixture, runBoth, writes } = require(path.join(fixtureDir, "harness.js"));

const tasks = new Map(loadFixture("tasks.json").active.map((task) => [task.id, task]));
const at = (date, time) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};

function writeLog(side) {
  return writes(side.calls).map((call) => [call.method, ...call.args]);
}

function assertSameWrites(both) {
  assert.deepEqual(writeLog(both.modular), writeLog(both.packaged), "modular and packaged writes differ");
}

test("update_task maps plannedAt to dueWithTime and moves the reminder with the time", async () => {
  const both = await runBoth("task.update", { taskId: "fx-timed-today", plannedAt: at("2026-11-09", "10:00") });
  assertSameWrites(both);
  // 08:50 reminder for 09:00 keeps its ten-minute offset.
  assert.deepEqual(writeLog(both.modular), [["updateTask", "fx-timed-today", { dueWithTime: at("2026-11-09", "10:00"), dueDay: null, remindAt: at("2026-11-09", "09:50") }, { isIgnoreShortSyntax: true }]]);
});

test("clearing a time dismisses its reminder and clears a legacy plannedAt", async () => {
  const timed = await runBoth("task.update", { taskId: "fx-timed-today", dueWithTime: null });
  const legacy = await runBoth("task.update", { taskId: "fx-legacy-planned", plannedAt: null, dueDay: "2026-11-09" });
  assertSameWrites(timed);
  assertSameWrites(legacy);
  assert.deepEqual(writeLog(timed.modular)[0][2], { dueWithTime: null, remindAt: null });
  assert.deepEqual(writeLog(legacy.modular)[0][2], { dueWithTime: null, remindAt: null, dueDay: "2026-11-09", plannedAt: null });
});

test("conflicting or invalid schedule inputs write nothing in either projection", async () => {
  const cases = [
    { taskId: "fx-backlog-001", dueWithTime: at("2026-11-10", "09:00"), plannedAt: at("2026-11-10", "10:00") },
    { taskId: "fx-backlog-001", dueWithTime: at("2026-11-10", "09:00"), dueDay: "2026-11-11" },
    { taskId: "fx-timed-today", dueDay: "2026-11-12" },
    { taskId: "fx-backlog-001", dueDay: "2026-02-30" },
    { taskId: "fx-backlog-001", dueWithTime: -5 },
  ];
  for (const payload of cases) {
    const both = await runBoth("task.update", payload);
    for (const side of [both.modular, both.packaged]) {
      assert.equal(side.ok, false, JSON.stringify(payload));
      assert.equal(side.error.code, "INVALID_REQUEST");
      assert.deepEqual(writes(side.calls), []);
    }
  }
});

test("bulk reschedule dry runs return the same canonical diffs and write nothing", async () => {
  const payload = {
    dryRun: true,
    updates: [
      { taskId: "fx-backlog-001", dueWithTime: at("2026-11-10", "09:00") },
      { taskId: "fx-day-overdue", dueDay: "2026-11-10" },
      { taskId: "fx-legacy-planned", planned_at: at("2026-11-10", "11:00") },
    ],
  };
  const both = await runBoth("task.bulkReschedule", payload);
  assert.deepEqual(both.modular.result, both.packaged.result);
  for (const side of [both.modular, both.packaged]) assert.deepEqual(writes(side.calls), []);
  const legacy = both.modular.result.results[2].changes.map((change) => change.field);
  assert.deepEqual(legacy, ["dueWithTime", "dueDay", "plannedAt"]);
});

test("plan for today files day-only work on the logical day and keeps timed work today", async () => {
  const both = await runBoth("task.planToday", { taskIds: ["fx-backlog-001", "fx-day-overdue", "fx-timed-before-day-start"] });
  assertSameWrites(both);
  assert.deepEqual(writeLog(both.modular), [
    // Only changed fields are written.
    ["updateTask", "fx-backlog-001", { dueDay: "2026-11-09" }],
    ["updateTask", "fx-day-overdue", { dueDay: "2026-11-09" }],
  ]);
  // 02:00 on the 10th is still the logical 9th with the four-hour day start.
  assert.equal(both.modular.result.results[2].note, "already scheduled with a time today");
});

test("clear schedule for a calendar day clears timed work in both projections", async () => {
  const both = await runBoth("task.clearScheduleForDay", { date: "2026-11-09", clearDueDay: true });
  assertSameWrites(both);
  assert.deepEqual(writeLog(both.modular).map((call) => call[1]).sort(), ["fx-day-today", "fx-legacy-planned", "fx-mixed-legacy", "fx-timed-today", "fx-timed-with-due-day"]);
});

test("auto-schedule dry runs agree, count existing work and write nothing", async () => {
  const payload = { startDate: "2026-11-10", endDate: "2026-11-11", capacityPerDayMinutes: 60, timezone: "America/Chicago", includeProjectIds: ["fixture-project-beta"] };
  const both = await runBoth("task.autoSchedule", payload);
  assert.deepEqual(both.modular.result, both.packaged.result);
  for (const side of [both.modular, both.packaged]) assert.deepEqual(writes(side.calls), []);
  const out = both.modular.result;
  assert.equal(out.dryRun, true);
  // 2026-11-10 already holds fx-timed-before-day-start, fx-day-tomorrow and fx-recurring (30 min by default each).
  assert.equal(out.capacity[0].existingMs, 90 * 60000);
  assert.ok(out.updates.every((update) => update.date === "2026-11-11"));
  assert.equal(out.updates[0].dueWithTime, at("2026-11-11", "09:00"));
});

test("create with dueTime sets the time after adding, in both projections", async () => {
  const both = await runBoth("task.create", { title: "Fixture call @tomorrow", dueDate: "2026-11-12", dueTime: "14:15" });
  assertSameWrites(both);
  const log = writeLog(both.modular);
  assert.equal(log[0][0], "addTask");
  assert.equal(log[0][1].dueDay, undefined);
  assert.equal(log[0][1].isIgnoreShortSyntax, true);
  assert.deepEqual(log[1], ["updateTask", "fx-created-1", { dueWithTime: at("2026-11-12", "14:15"), dueDay: null }]);
  assert.equal(tasks.has("fx-created-1"), false);
});

test("create with subtasks gives subtasks no tags or project of their own", async () => {
  const both = await runBoth("task.createWithSubtasks", { title: "Fixture launch", projectId: "fixture-project-alpha", tagIds: ["fixture-tag-focus"], subtasks: [{ title: "Fixture step 30m" }] });
  assertSameWrites(both);
  const [parent, child] = writeLog(both.modular).map((call) => call[1]);
  assert.equal(parent.projectId, "fixture-project-alpha");
  assert.deepEqual(parent.tagIds, ["fixture-tag-focus"]);
  assert.deepEqual(Object.keys(child).sort(), ["isIgnoreShortSyntax", "notes", "parentId", "timeEstimate", "title"]);
  assert.equal(child.timeEstimate, 30 * 60000);
});

test("schedule cleanup never touches true deadlines (#27)", async () => {
  const deadlineFields = ["deadlineDay", "deadlineWithTime", "deadlineRemindAt"];
  const runs = [
    await runBoth("task.clearScheduleForDay", { date: "2026-11-12", clearDueDay: true }),
    await runBoth("task.planToday", { taskIds: ["fx-deadline-day"] }),
    await runBoth("task.planToday", { taskIds: ["fx-deadline-day"], unplan: true }),
    await runBoth("task.bulkReschedule", { updates: [{ taskId: "fx-deadline-day", dueDay: "2026-11-10" }] }),
  ];
  for (const both of runs) {
    for (const side of [both.modular, both.packaged]) {
      for (const call of writes(side.calls)) {
        for (const field of deadlineFields) assert.equal(field in call.args[1], false, `${call.method} wrote ${field}`);
      }
      assert.equal(side.state.active.get("fx-deadline-day").deadlineDay, "2026-11-12");
    }
  }
});

test("deadline edits are refused by both plugin projections (#27)", async () => {
  const both = await runBoth("task.update", { taskId: "fx-deadline-day", deadlineDay: "2026-11-13" });
  for (const side of [both.modular, both.packaged]) {
    assert.equal(side.error.code, "UNSUPPORTED_ACTION");
    assert.deepEqual(writes(side.calls), []);
  }
});

test("compact summaries show deadlines next to the schedule (#27)", async () => {
  // A deadline is not a schedule: the task stays unscheduled and shows its deadline.
  const both = await runBoth("task.findUnscheduledActive", {});
  for (const side of [both.modular, both.packaged]) {
    const task = side.result.tasks.find((t) => t.id === "fx-deadline-day");
    assert.equal(task.deadlineDay, "2026-11-12");
    assert.equal(task.deadlineWithTime, null);
    assert.equal(task.scheduleKind, "none");
  }
  assert.deepEqual(both.modular.result, both.packaged.result);
});

test("review fixes behave the same in both projections", async () => {
  // Clearing a day without clearDueDay keeps the task on the day.
  const keep = await runBoth("task.clearScheduleForDay", { date: "2026-11-09" });
  assertSameWrites(keep);
  const timed = writeLog(keep.modular).find((call) => call[1] === "fx-timed-today");
  assert.deepEqual(timed[2], { dueWithTime: null, remindAt: null, dueDay: "2026-11-09" });

  // Work never spills past midnight, and the reported day is the real day.
  const late = await runBoth("task.autoSchedule", { startDate: "2026-11-12", endDate: "2026-11-13", workStart: "22:00", capacityPerDayMinutes: 240, timezone: "America/Chicago", includeProjectIds: ["fixture-project-beta"] });
  assert.deepEqual(late.modular.result, late.packaged.result);
  for (const update of late.modular.result.updates) {
    const d = new Date(update.dueWithTime);
    assert.equal(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, update.date);
  }

  // Years before 1000 are refused.
  const ancient = await runBoth("task.scheduleRange", { startDate: "0026-11-09" });
  for (const side of [ancient.modular, ancient.packaged]) assert.equal(side.error.code, "INVALID_REQUEST");

  // Subtask tags are refused before anything is created.
  const tagged = await runBoth("task.createWithSubtasks", { title: "Fixture parent", subtasks: [{ title: "Fixture child", tagIds: ["fixture-tag-focus"] }] });
  for (const side of [tagged.modular, tagged.packaged]) {
    assert.equal(side.error.code, "INVALID_REQUEST");
    assert.deepEqual(writes(side.calls), []);
  }

  // Snack text uses v20's msg field; delta 0 is passed through.
  const snack = await runBoth("notification.show", { message: "Fixture", type: "bogus" });
  assert.deepEqual(snack.modular.result, snack.packaged.result);
  assert.deepEqual(writeLog(snack.modular), writeLog(snack.packaged));
});

test("counter delta 0 is passed through by both projections", async () => {
  const both = await runBoth("counter.increment", { id: "fixture-plugin-counter", delta: 0 });
  assertSameWrites(both);
  assert.deepEqual(writeLog(both.modular), [["incrementCounter", "fixture-plugin-counter", 0]]);
});
