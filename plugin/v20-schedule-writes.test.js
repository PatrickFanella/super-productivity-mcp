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
    ["updateTask", "fx-backlog-001", { dueDay: "2026-11-09", dueWithTime: null, remindAt: null }],
    ["updateTask", "fx-day-overdue", { dueDay: "2026-11-09", dueWithTime: null, remindAt: null }],
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
  const both = await runBoth("task.createWithSubtasks", { title: "Fixture launch", projectId: "fixture-project-alpha", tagIds: ["fixture-tag-focus"], subtasks: [{ title: "Fixture step 30m", tagIds: ["fixture-tag-waiting"] }] });
  assertSameWrites(both);
  const [parent, child] = writeLog(both.modular).map((call) => call[1]);
  assert.equal(parent.projectId, "fixture-project-alpha");
  assert.deepEqual(parent.tagIds, ["fixture-tag-focus"]);
  assert.deepEqual(Object.keys(child).sort(), ["isIgnoreShortSyntax", "notes", "parentId", "timeEstimate", "title"]);
  assert.equal(child.timeEstimate, 30 * 60000);
});
