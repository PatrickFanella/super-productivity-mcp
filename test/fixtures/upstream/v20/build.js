#!/usr/bin/env node
// Deterministic builder for the synthetic Super Productivity v20 fixtures.
//
//   node test/fixtures/upstream/v20/build.js          rewrite the JSON files
//   node test/fixtures/upstream/v20/build.js --check  fail if they drifted
//
// Every timestamp is a wall-clock time in America/Chicago, the zone the
// fixtures and their tests use. See README.md for the construction rules.
process.env.TZ = "America/Chicago";

const fs = require("node:fs");
const path = require("node:path");

const UPSTREAM = {
  version: "20.0.0",
  commit: "4db0e11236bc784d3184a9e252930b4bd53df823",
};
const SUITE_BASELINE = "822f4b01eac19222cb89f421adbe6b6fe7209571";
const TIME_ZONE = "America/Chicago";
const TODAY = "2026-11-09";
// A delayed day start: before 04:00 the logical day is still the previous one.
const START_OF_NEXT_DAY_DIFF_MS = 4 * 60 * 60 * 1000;
const BACKLOG_TASK_COUNT = 110;

const H = 60 * 60 * 1000;
const M = 60 * 1000;

function local(date, time = "00:00") {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function task(id, title, fields = {}) {
  return {
    id,
    title,
    notes: "",
    timeEstimate: 0,
    timeSpent: 0,
    timeSpentOnDay: {},
    isDone: false,
    doneOn: null,
    projectId: "fixture-project-alpha",
    tagIds: [],
    parentId: null,
    subTaskIds: [],
    created: local("2026-10-01", "09:00"),
    dueDay: null,
    dueWithTime: null,
    remindAt: null,
    repeatCfgId: null,
    ...fields,
  };
}

function sumDays(timeSpentOnDay) {
  return Object.values(timeSpentOnDay).reduce((sum, value) => sum + value, 0);
}

function buildTasks() {
  const childOneDays = { "2026-11-06": 30 * M, "2026-11-09": 15 * M };
  const childTwoDays = { "2026-11-06": 45 * M };
  const parentDays = { "2026-11-06": 75 * M, "2026-11-09": 15 * M };

  const active = [
    task("fx-timed-today", "Fixture timed task today 09:00", {
      dueWithTime: local(TODAY, "09:00"),
      remindAt: local(TODAY, "08:50"),
      timeEstimate: 30 * M,
    }),
    task("fx-timed-before-day-start", "Fixture timed task 02:00 after midnight", {
      // Calendar day 2026-11-10, logical day 2026-11-09 with the 4h offset.
      dueWithTime: local("2026-11-10", "02:00"),
    }),
    task("fx-timed-with-due-day", "Fixture timed task carrying dueDay", {
      dueDay: TODAY,
      dueWithTime: local(TODAY, "14:30"),
    }),
    task("fx-day-today", "Fixture day-only task today", { dueDay: TODAY, timeEstimate: 20 * M }),
    task("fx-day-tomorrow", "Fixture day-only task tomorrow", { dueDay: "2026-11-10" }),
    task("fx-day-overdue", "Fixture day-only task overdue", { dueDay: "2026-11-02" }),
    task("fx-legacy-planned", "Fixture legacy plannedAt task", {
      // Shape written by older suites: plannedAt only, plus the stored TODAY tag.
      plannedAt: local(TODAY, "10:00"),
      tagIds: ["TODAY"],
    }),
    task("fx-legacy-stale-today-tag", "Fixture stale stored TODAY tag", {
      dueDay: "2026-11-02",
      tagIds: ["TODAY"],
    }),
    task("fx-mixed-legacy", "Fixture plannedAt disagreeing with dueWithTime", {
      plannedAt: local("2026-11-08", "16:00"),
      dueWithTime: local(TODAY, "16:00"),
    }),
    task("fx-done-today", "Fixture completed task today", {
      dueDay: TODAY,
      isDone: true,
      doneOn: local(TODAY, "08:00"),
    }),
    task("fx-deadline-day", "Fixture task with a day deadline", {
      deadlineDay: "2026-11-12",
    }),
    task("fx-parent", "Fixture parent task", {
      subTaskIds: ["fx-child-1", "fx-child-2"],
      // The app rolls subtask time up into the parent.
      timeSpentOnDay: parentDays,
      timeSpent: sumDays(parentDays),
      tagIds: ["fixture-tag-focus"],
    }),
    task("fx-child-1", "Fixture child task one", {
      parentId: "fx-parent",
      timeSpentOnDay: childOneDays,
      timeSpent: sumDays(childOneDays),
    }),
    task("fx-child-2", "Fixture child task two", {
      parentId: "fx-parent",
      timeSpentOnDay: childTwoDays,
      timeSpent: sumDays(childTwoDays),
    }),
    task("fx-recurring", "Fixture recurring task instance", {
      repeatCfgId: "fx-repeat-weekly-custom",
      dueDay: "2026-11-10",
    }),
    task("fx-archived-project-task", "Fixture task in an archived project", {
      projectId: "fixture-project-archived",
    }),
    task("fx-dst-spring", "Fixture task on the spring-forward day", {
      dueWithTime: local("2026-03-08", "03:30"),
    }),
    task("fx-dst-fall", "Fixture task on the fall-back day", {
      // 01:30 happens twice on 2026-11-01; the builder takes the first (CDT).
      dueWithTime: local("2026-11-01", "01:30"),
    }),
  ];
  for (let i = 1; i <= BACKLOG_TASK_COUNT; i++) {
    const n = String(i).padStart(3, "0");
    active.push(
      task(`fx-backlog-${n}`, `Fixture backlog task ${n}`, {
        projectId: "fixture-project-beta",
        timeEstimate: i % 2 === 0 ? 30 * M : 0,
        created: local("2026-09-01", "09:00") + i * M,
      }),
    );
  }

  const archivedChildDays = { "2026-11-05": 40 * M };
  const archivedLeafDays = { "2026-11-04": 1 * H, "2026-11-05": 20 * M };
  const archived = [
    task("fx-archived-parent", "Fixture archived parent", {
      isDone: true,
      doneOn: local("2026-11-05", "17:00"),
      subTaskIds: ["fx-archived-child"],
      timeSpentOnDay: { ...archivedChildDays },
      timeSpent: sumDays(archivedChildDays),
    }),
    task("fx-archived-child", "Fixture archived child", {
      isDone: true,
      doneOn: local("2026-11-05", "16:00"),
      parentId: "fx-archived-parent",
      timeSpentOnDay: archivedChildDays,
      timeSpent: sumDays(archivedChildDays),
    }),
    task("fx-archived-leaf", "Fixture archived leaf task", {
      isDone: true,
      doneOn: local("2026-11-05", "12:00"),
      timeSpentOnDay: archivedLeafDays,
      timeSpent: sumDays(archivedLeafDays),
    }),
    task("fx-archived-legacy", "Fixture archived legacy plannedAt task", {
      isDone: true,
      doneOn: local("2026-10-30", "12:00"),
      plannedAt: local("2026-10-30", "09:00"),
    }),
  ];

  return {
    meta: { upstream: UPSTREAM, suiteBaseline: SUITE_BASELINE, timeZone: TIME_ZONE },
    dayContext: { todayStr: TODAY, startOfNextDayDiffMs: START_OF_NEXT_DAY_DIFF_MS },
    projects: [
      { id: "INBOX_PROJECT", title: "Inbox", isArchived: false, taskIds: [], backlogTaskIds: [], noteIds: [] },
      { id: "fixture-project-alpha", title: "Fixture Project Alpha", isArchived: false, taskIds: [], backlogTaskIds: [], noteIds: ["fx-note-project"] },
      { id: "fixture-project-beta", title: "Fixture Project Beta", isArchived: false, taskIds: [], backlogTaskIds: [], noteIds: [] },
      { id: "fixture-project-archived", title: "Fixture Archived Project", isArchived: true, taskIds: [], backlogTaskIds: [], noteIds: [] },
    ],
    tags: [
      { id: "TODAY", title: "Today", taskIds: [] },
      { id: "fixture-tag-focus", title: "Fixture Focus", taskIds: ["fx-parent"] },
      { id: "fixture-tag-waiting", title: "Fixture Waiting", taskIds: [] },
    ],
    active,
    archived,
    // Standalone notes: PluginAPI.getAppState().notes and GET /notes shape.
    notes: [
      { id: "fx-note-project", content: "Fixture project note body", projectId: "fixture-project-alpha", isPinnedToToday: false, created: local("2026-11-01", "09:00"), modified: local("2026-11-02", "09:00") },
      { id: "fx-note-today", content: "Fixture Today note body", projectId: null, isPinnedToToday: true, created: local("2026-11-09", "08:00"), modified: local("2026-11-09", "08:00") },
      { id: "fx-note-project-today", content: "Fixture pinned project note body", projectId: "fixture-project-beta", isPinnedToToday: true, created: local("2026-11-05", "09:00"), modified: local("2026-11-05", "09:00") },
    ],
  };
}

function buildRepeatCfgs() {
  const base = {
    projectId: "fixture-project-alpha",
    lastTaskCreationDay: "2026-11-03",
    tagIds: [],
    order: 0,
    isPaused: false,
    repeatEvery: 1,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  };
  return {
    meta: { upstream: UPSTREAM },
    // Fields POST/PATCH /task-repeat-cfgs accept (besides taskId on create).
    restWritableFields: [
      "quickSetting",
      "startDate",
      "repeatCycle",
      "repeatEvery",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
      "isPaused",
      "skipOverdue",
    ],
    repeatCfgs: [
      { ...base, id: "fx-repeat-daily", title: "Fixture daily repeat", quickSetting: "DAILY", repeatCycle: "DAILY", startDate: "2026-11-01", skipOverdue: true },
      {
        ...base,
        id: "fx-repeat-weekly-custom",
        title: "Fixture every second Tuesday and Thursday",
        quickSetting: "CUSTOM",
        repeatCycle: "WEEKLY",
        repeatEvery: 2,
        tuesday: true,
        thursday: true,
        startDate: "2026-11-03",
        skipOverdue: false,
      },
      {
        ...base,
        id: "fx-repeat-monthly-nth",
        title: "Fixture second Monday of the month",
        quickSetting: "MONTHLY_NTH_WEEKDAY",
        repeatCycle: "MONTHLY",
        startDate: "2026-11-09",
        monthlyWeekOfMonth: 2,
        monthlyWeekday: 1,
        skipOverdue: false,
      },
      { ...base, id: "fx-repeat-paused", title: "Fixture paused weekday repeat", quickSetting: "MONDAY_TO_FRIDAY", repeatCycle: "WEEKLY", monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, startDate: "2026-10-01", isPaused: true, skipOverdue: false },
      {
        ...base,
        id: "fx-repeat-advanced",
        title: "Fixture repeat with fields REST cannot write",
        quickSetting: "CUSTOM",
        repeatCycle: "DAILY",
        startDate: "2026-11-01",
        startTime: "07:30",
        remindAt: "AtStart",
        repeatFromCompletionDate: true,
        waitForCompletion: true,
        repeatUntilDay: "2026-12-31",
        shouldInheritSubtasks: true,
        subTaskTemplates: [{ title: "Fixture template step", timeEstimate: 10 * M }],
        skipOverdue: false,
      },
    ],
  };
}

function buildCounters() {
  return {
    meta: { upstream: UPSTREAM },
    // getAllSimpleCounters() / GET /simple-counters shape.
    simpleCounters: [
      { id: "fx-counter-water", title: "Fixture water glasses", type: "ClickCounter", isEnabled: true, isOn: false, countOnDay: { "2026-11-07": 6, "2026-11-08": 8, "2026-11-09": 2 } },
      { id: "fx-counter-reading", title: "Fixture reading stopwatch", type: "StopWatch", isEnabled: true, isOn: false, countOnDay: { "2026-11-08": 25 * M, "2026-11-09": 10 * M } },
      { id: "fx-counter-stretch", title: "Fixture stretch reminder", type: "RepeatedCountdownReminder", isEnabled: false, isOn: false, countOnDay: {} },
    ],
    // getAllCounters() shape: the plugin's own scalar counters, unrelated to simple counters.
    pluginCounters: { "fixture-plugin-counter": 3 },
  };
}

function ok(data) {
  return { ok: true, data };
}

function fail(code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { ok: false, error };
}

function buildRestEnvelopes(tasks) {
  const byId = new Map([...tasks.active, ...tasks.archived].map((t) => [t.id, t]));
  const restored = { ...byId.get("fx-archived-leaf") };
  return {
    meta: {
      upstream: UPSTREAM,
      baseUrl: "http://127.0.0.1:3876",
      note: "body is the HTTP response body; a string body is sent verbatim.",
    },
    responses: {
      health: { method: "GET", path: "/health", status: 200, body: ok({ server: "up", rendererReady: true }) },
      healthRendererNotReady: { method: "GET", path: "/health", status: 200, body: ok({ server: "up", rendererReady: false }) },
      archiveOk: { method: "POST", path: "/tasks/fx-day-overdue/archive", status: 200, body: ok({ id: "fx-day-overdue", archived: true }) },
      archiveSubtask: {
        method: "POST",
        path: "/tasks/fx-child-1/archive",
        status: 400,
        body: fail("INVALID_INPUT", "Cannot archive a subtask on its own; archive its parent task, which takes its subtasks with it"),
      },
      archiveUnknown: { method: "POST", path: "/tasks/fx-missing/archive", status: 404, body: fail("TASK_NOT_FOUND", "Task not found") },
      restoreOk: { method: "POST", path: "/tasks/fx-archived-leaf/restore", status: 200, body: ok(restored) },
      restoreNotArchived: { method: "POST", path: "/tasks/fx-day-today/restore", status: 404, body: fail("TASK_NOT_FOUND", "Task not found in archive") },
      status: {
        method: "GET",
        path: "/status",
        status: 200,
        body: ok({ currentTask: null, currentTaskId: null, taskCount: tasks.active.length, trackingOnOtherDevice: null }),
      },
      statusTrackingOnOtherDevice: {
        method: "GET",
        path: "/status",
        status: 200,
        body: ok({
          currentTask: null,
          currentTaskId: null,
          taskCount: tasks.active.length,
          trackingOnOtherDevice: { taskId: "fx-day-today", deviceLabel: "Fixture laptop", sinceTs: local(TODAY, "08:15") },
        }),
      },
      currentNone: { method: "GET", path: "/task-control/current", status: 200, body: ok(null) },
      currentTask: { method: "GET", path: "/task-control/current", status: 200, body: ok(byId.get("fx-child-1")) },
      setCurrent: { method: "POST", path: "/task-control/current", status: 200, body: ok({ currentTaskId: "fx-child-1" }) },
      stop: { method: "POST", path: "/task-control/stop", status: 200, body: ok({ currentTaskId: null }) },
      addTime: {
        method: "POST",
        path: "/tasks/fx-day-today/time",
        status: 200,
        body: ok({ ...byId.get("fx-day-today"), timeSpent: 25 * M, timeSpentOnDay: { [TODAY]: 25 * M } }),
      },
      addTimeParent: {
        method: "POST",
        path: "/tasks/fx-parent/time",
        status: 400,
        body: fail("INVALID_INPUT", "Cannot log time on a task with subtasks; log it on a subtask"),
      },
      addTimeFuture: { method: "POST", path: "/tasks/fx-day-today/time", status: 400, body: fail("INVALID_INPUT", "date must not be in the future") },
      focusNone: { method: "GET", path: "/focus", status: 200, body: ok({ mode: "Pomodoro", cycle: 1, isSessionDone: false, timer: null }) },
      focusRunning: {
        method: "GET",
        path: "/focus",
        status: 200,
        body: ok({ mode: "Pomodoro", cycle: 2, isSessionDone: false, timer: { purpose: "work", status: "running", isOvertime: false, isLongBreak: false, elapsedMs: 10 * M, remainingMs: 15 * M, durationMs: 25 * M } }),
      },
      focusPausedOvertime: {
        method: "GET",
        path: "/focus",
        status: 200,
        body: ok({ mode: "Countdown", cycle: 1, isSessionDone: false, timer: { purpose: "work", status: "paused", isOvertime: true, isLongBreak: false, elapsedMs: 32 * M, remainingMs: 0, durationMs: 30 * M } }),
      },
      focusBreakDone: {
        method: "GET",
        path: "/focus",
        status: 200,
        body: ok({ mode: "Pomodoro", cycle: 3, isSessionDone: false, timer: { purpose: "break", status: "done", isOvertime: false, isLongBreak: false, elapsedMs: 5 * M, remainingMs: 0, durationMs: 5 * M } }),
      },
      focusSessionDone: { method: "GET", path: "/focus", status: 200, body: ok({ mode: "Flowtime", cycle: 1, isSessionDone: true, timer: null }) },
      repeatCfgDelete: { method: "DELETE", path: "/task-repeat-cfgs/fx-repeat-daily", status: 200, body: ok({ deleted: true, id: "fx-repeat-daily" }) },
      repeatCfgUnsupportedField: {
        method: "PATCH",
        path: "/task-repeat-cfgs/fx-repeat-daily",
        status: 400,
        body: fail("UNSUPPORTED_FIELD", "Field startTime cannot be changed through this endpoint"),
      },
      repeatCfgNotFound: { method: "GET", path: "/task-repeat-cfgs/fx-missing", status: 404, body: fail("REPEAT_CFG_NOT_FOUND", "Repeat config not found") },
      unauthorized: {
        method: "GET",
        path: "/tasks",
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
        body: fail("UNAUTHORIZED", "Invalid authorization token. Find the token in Settings → Misc → Access Token."),
      },
      apiDisabled: { method: "GET", path: "/tasks", status: 503, body: fail("API_DISABLED", "Local REST API is disabled") },
      appNotReady: { method: "GET", path: "/tasks", status: 503, body: fail("APP_NOT_READY", "Renderer is not ready yet") },
      tooManyRequests: { method: "GET", path: "/tasks", status: 429, body: fail("TOO_MANY_REQUESTS", "Too many concurrent requests (limit: 50)") },
      rendererTimeout: { method: "POST", path: "/tasks/fx-day-overdue/archive", status: 504, body: fail("RENDERER_TIMEOUT", "Renderer request timed out") },
      routeNotFound: { method: "POST", path: "/tasks/fx-day-today/unknown", status: 404, body: fail("NOT_FOUND", "Route not found") },
      internalError: { method: "GET", path: "/tasks", status: 500, body: fail("INTERNAL_ERROR", "Internal error") },
      malformed: { method: "POST", path: "/tasks/fx-day-overdue/archive", status: 200, body: "<html>not json</html>" },
      successWithoutOk: { method: "POST", path: "/tasks/fx-day-overdue/archive", status: 200, body: { data: { id: "fx-day-overdue", archived: true } } },
    },
  };
}

function buildDayContexts() {
  return {
    meta: { upstream: UPSTREAM, timeZone: TIME_ZONE },
    // todayStr is the local date of (now - startOfNextDayDiffMs).
    cases: [
      { name: "midday", now: local(TODAY, "12:00"), startOfNextDayDiffMs: 0, todayStr: TODAY },
      { name: "before delayed day start", now: local("2026-11-10", "02:00"), startOfNextDayDiffMs: START_OF_NEXT_DAY_DIFF_MS, todayStr: TODAY },
      { name: "after delayed day start", now: local("2026-11-10", "05:00"), startOfNextDayDiffMs: START_OF_NEXT_DAY_DIFF_MS, todayStr: "2026-11-10" },
      { name: "spring-forward day", now: local("2026-03-08", "12:00"), startOfNextDayDiffMs: 0, todayStr: "2026-03-08", calendarDayHours: 23 },
      { name: "fall-back day", now: local("2026-11-01", "12:00"), startOfNextDayDiffMs: 0, todayStr: "2026-11-01", calendarDayHours: 25 },
    ],
  };
}

function buildAll() {
  const tasks = buildTasks();
  return {
    "tasks.json": tasks,
    "repeat-cfgs.json": buildRepeatCfgs(),
    "simple-counters.json": buildCounters(),
    "rest-envelopes.json": buildRestEnvelopes(tasks),
    "day-contexts.json": buildDayContexts(),
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main(argv) {
  const check = argv.includes("--check");
  const drifted = [];
  for (const [name, value] of Object.entries(buildAll())) {
    const file = path.join(__dirname, name);
    const text = serialize(value);
    if (check) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (current !== text) drifted.push(name);
    } else {
      fs.writeFileSync(file, text);
    }
  }
  if (drifted.length) {
    console.error(`v20 fixtures drifted from build.js: ${drifted.join(", ")}. Run node test/fixtures/upstream/v20/build.js`);
    return 1;
  }
  return 0;
}

module.exports = { buildAll, serialize };

if (require.main === module) process.exit(main(process.argv.slice(2)));
