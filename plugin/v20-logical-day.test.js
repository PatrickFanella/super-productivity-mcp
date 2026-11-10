// Logical Today, calendar ranges and DST on the v20 fixtures (#20). Each case
// runs through the modular bridge and the packaged plugin.js.
process.env.TZ = "America/Chicago";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const fixtureDir = path.join(__dirname, "..", "test", "fixtures", "upstream", "v20");
const { createPluginApi, loadFixture, runBoth, runModular, startPackaged } = require(path.join(fixtureDir, "harness.js"));

const tasksFixture = loadFixture("tasks.json");
const byId = new Map(tasksFixture.active.map((task) => [task.id, task]));

// The app's isTaskInToday: dueWithTime shifted by the day-start offset, else dueDay.
function appTodayIds({ todayStr, startOfNextDayDiffMs }) {
  const localDate = (ms) => {
    const d = new Date(ms - startOfNextDayDiffMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return tasksFixture.active
    .filter((task) => !task.isDone)
    .filter((task) => (task.dueWithTime > 0 ? localDate(task.dueWithTime) === todayStr : task.dueDay === todayStr))
    .map((task) => task.id)
    .sort();
}

const ids = (side) => side.result.tasks.map((task) => task.id).sort();

test("tagId TODAY matches the app after a delayed day start", async () => {
  const both = await runBoth("task.list", { tagId: "TODAY", includeDone: false });
  const expected = appTodayIds(tasksFixture.dayContext);
  // 02:00 on 2026-11-10 is still 2026-11-09 with a four-hour day start.
  assert.ok(expected.includes("fx-timed-before-day-start"));
  for (const side of [both.modular, both.packaged]) {
    assert.deepEqual(ids(side), expected);
    assert.deepEqual(side.result.dayContext, { ...tasksFixture.dayContext, source: "app" });
  }
});

test("plannedForToday and overdue use the logical day and keep legacy plannedAt", async () => {
  const today = await runBoth("task.list", { plannedForToday: true, includeDone: false });
  const overdue = await runBoth("task.list", { overdue: true, includeDone: false });
  for (const side of ["modular", "packaged"]) {
    assert.deepEqual(ids(today[side]), [...appTodayIds(tasksFixture.dayContext), "fx-legacy-planned"].sort());
    assert.deepEqual(ids(overdue[side]), ["fx-day-overdue", "fx-dst-fall", "fx-dst-spring", "fx-legacy-stale-today-tag"]);
  }
});

test("each call re-reads the day context, so a day change is picked up", async () => {
  let ctx = { ...tasksFixture.dayContext };
  const { api } = createPluginApi({ getDayContext: async () => ctx });
  const packaged = await startPackaged(api);
  try {
    const first = await packaged.call("task.list", { tagId: "TODAY", includeDone: false });
    ctx = { todayStr: "2026-11-10", startOfNextDayDiffMs: ctx.startOfNextDayDiffMs };
    const second = await packaged.call("task.list", { tagId: "TODAY", includeDone: false });
    const modular = await runModular(api, "task.list", { tagId: "TODAY", includeDone: false });
    assert.ok(first.result.tasks.some((task) => task.id === "fx-timed-today"));
    assert.deepEqual(ids(second), appTodayIds(ctx));
    assert.deepEqual(ids(modular), appTodayIds(ctx));
    assert.deepEqual(ids(second), ["fx-day-tomorrow", "fx-recurring"]);
  } finally {
    packaged.close();
  }
});

test("hosts without getDayContext fall back to the host clock and say so", async () => {
  const both = await runBoth("task.dayContext", {}, { getDayContext: undefined });
  const now = new Date();
  const hostToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const side of [both.modular, both.packaged]) {
    assert.deepEqual(side.result, { todayStr: hostToday, startOfNextDayDiffMs: 0, source: "host-clock" });
  }
  const app = await runBoth("task.dayContext", {});
  for (const side of [app.modular, app.packaged]) assert.deepEqual(side.result, { ...tasksFixture.dayContext, source: "app" });
});

test("schedule health is logical without a date and calendar with one", async () => {
  const logical = await runBoth("task.scheduleHealth", {});
  const calendar = await runBoth("task.scheduleHealth", { date: "2026-11-09" });
  for (const side of ["modular", "packaged"]) {
    const l = logical[side].result;
    assert.equal(l.date, "2026-11-09");
    assert.equal(l.dayBasis, "logical");
    assert.equal(l.timeZone, "America/Chicago");
    assert.ok(l.tasks.plannedToday.some((task) => task.id === "fx-timed-before-day-start"));
    const c = calendar[side].result;
    assert.equal(c.dayBasis, "calendar");
    assert.equal(c.tasks.plannedToday.some((task) => task.id === "fx-timed-before-day-start"), false);
  }
  assert.deepEqual(logical.modular.result, logical.packaged.result);
});

test("calendar ranges name their zone and count DST days by the calendar", async () => {
  const spring = await runBoth("task.scheduleRange", { startDate: "2026-03-07", endDate: "2026-03-09" });
  const fall = await runBoth("task.scheduleRange", { startDate: "2026-11-01" });
  for (const side of ["modular", "packaged"]) {
    assert.equal(spring[side].result.timeZone, "America/Chicago");
    assert.equal(spring[side].result.dayBasis, "calendar");
    assert.deepEqual(spring[side].result.days.map((day) => [day.date, day.tasks.map((task) => task.id)]), [["2026-03-07", []], ["2026-03-08", ["fx-dst-spring"]], ["2026-03-09", []]]);
    assert.deepEqual(fall[side].result.days.map((day) => [day.date, day.tasks.map((task) => task.id)]), [["2026-11-01", ["fx-dst-fall"]]]);
  }
});

test("invalid calendar dates and reversed ranges are refused", async () => {
  const cases = [
    ["task.scheduleRange", { startDate: "2026-02-30" }],
    ["task.scheduleRange", { startDate: "2026-11-10", endDate: "2026-11-09" }],
    ["task.scheduleHealth", { date: "2026-13-01" }],
    ["task.findStaleSchedule", { beforeDate: "2026-04-31" }],
    ["task.worklog", { startDate: "2026-02-29" }],
    ["task.makePlannedAt", { date: "2026-02-29" }],
    ["task.makePlannedAt", { date: "2026-02-28", time: "24:00" }],
    ["task.makePlannedAt", { date: "2026-02-28", timezone: "Not/AZone" }],
  ];
  for (const [action, payload] of cases) {
    const both = await runBoth(action, payload);
    for (const side of [both.modular, both.packaged]) assert.equal(side.error && side.error.code, "INVALID_REQUEST", `${action} ${JSON.stringify(payload)}`);
  }
});

for (const hostZone of ["America/Chicago", "UTC"]) {
  test(`make_planned_at handles America/Chicago DST changes with the host in ${hostZone}`, async () => {
    process.env.TZ = hostZone;
    try {
      const tz = "America/Chicago";
      const gap = await runBoth("task.makePlannedAt", { date: "2026-03-08", time: "02:30", timezone: tz });
      const afterGap = await runBoth("task.makePlannedAt", { date: "2026-03-08", time: "03:30", timezone: tz });
      const repeated = await runBoth("task.makePlannedAt", { date: "2026-11-01", time: "01:30", timezone: tz });
      const earlier = await runBoth("task.makePlannedAt", { date: "2026-11-01", time: "01:30", timezone: tz, disambiguation: "earlier" });
      const later = await runBoth("task.makePlannedAt", { date: "2026-11-01", time: "01:30", timezone: tz, disambiguation: "later" });
      for (const side of ["modular", "packaged"]) {
        assert.equal(gap[side].error.code, "INVALID_REQUEST");
        assert.match(gap[side].error.message, /does not exist/);
        assert.equal(afterGap[side].result.plannedAt, byId.get("fx-dst-spring").dueWithTime);
        assert.equal(repeated[side].error.code, "INVALID_REQUEST");
        assert.match(repeated[side].error.message, /happens twice/);
        assert.equal(earlier[side].result.plannedAt, byId.get("fx-dst-fall").dueWithTime);
        assert.equal(later[side].result.plannedAt - earlier[side].result.plannedAt, 60 * 60 * 1000);
        assert.equal(later[side].result.timezone, tz);
      }
    } finally {
      process.env.TZ = "America/Chicago";
    }
  });
}

test("with the host in UTC, Today still follows the app's day context", async () => {
  process.env.TZ = "UTC";
  try {
    const ctx = { todayStr: "2026-11-09", startOfNextDayDiffMs: 0 };
    const both = await runBoth("task.list", { tagId: "TODAY", includeDone: false }, { getDayContext: async () => ctx });
    for (const side of [both.modular, both.packaged]) assert.deepEqual(ids(side), appTodayIds(ctx));
  } finally {
    process.env.TZ = "America/Chicago";
  }
});
