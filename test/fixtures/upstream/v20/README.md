# Super Productivity v20 fixtures

Synthetic data and a test harness for checking the suite against stock
Super Productivity v20. Nothing here comes from a real profile.

## Provenance

- Upstream release: v20.0.0, commit
  `4db0e11236bc784d3184a9e252930b4bd53df823`.
- Suite baseline: `822f4b01eac19222cb89f421adbe6b6fe7209571`.
- Shapes were read from these upstream files at that commit:
  - `packages/plugin-api/src/types.ts`: `Task`, `PluginDayContext`,
    `getDayContext`, `startTracking`, `stopTracking`, `PluginSimpleCounterFull`.
  - `src/app/plugins/allowed-plugin-actions.const.ts`: the action types a
    plugin may dispatch. Stock v20 refuses every other type.
  - `src/app/plugins/util/plugin-iframe.util.ts`: the methods an iframe plugin
    can call.
  - `electron/local-rest-api.ts`, `src/app/core/electron/local-rest-api-response.ts`:
    the `{ok, data}` / `{ok:false, error}` envelope and transport errors
    (`UNAUTHORIZED`, `API_DISABLED`, `APP_NOT_READY`, `TOO_MANY_REQUESTS`,
    `RENDERER_TIMEOUT`, `INTERNAL_ERROR`).
  - `src/app/features/tasks/local-rest-api-task-routes.service.ts`: task,
    archive, restore, time, status and task-control routes, and `isTaskInToday`.
  - `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts` and
    `local-rest-api-task-repeat-cfg-routes.service.ts`: repeat configs and the
    fields REST can write.
  - `src/app/features/simple-counter/simple-counter.model.ts`: simple counters.
  - `docs/wiki/3.01-API.md`: the documented Local REST API.

These are source observations. They are not runtime qualification against a
running app.

## Files

| File | Contents |
| --- | --- |
| `build.js` | Generates every JSON file. `--check` fails if a file drifted. |
| `tasks.json` | Projects, tags, the logical day, 128 active and 4 archived tasks. |
| `repeat-cfgs.json` | Repeat configs, including one with fields REST cannot write. |
| `simple-counters.json` | Simple counters and the plugin's scalar counters. |
| `rest-envelopes.json` | Local REST responses: successes, route errors and transport errors. |
| `day-contexts.json` | Logical-day cases, including a delayed day start and both DST changes. |
| `harness.js` | Runs an action through the modular bridge and packaged `plugin.js`. |

## Construction rules

- Edit `build.js`, then run `node test/fixtures/upstream/v20/build.js`. Never
  edit the JSON by hand; `plugin/v20-baseline.test.js` checks for drift.
- Times are wall-clock times in America/Chicago. Tests that read the fixtures
  set `TZ=America/Chicago` before any date is created.
- The logical day is `2026-11-09` with a four-hour day start
  (`startOfNextDayDiffMs: 14400000`): before 04:00, the day is still the
  previous one.
- Titles start with `Fixture`, IDs with `fx-` or `fixture-`. Do not add names,
  email addresses, tokens or other personal data.
- Task shapes cover timed (`dueWithTime`), day-only (`dueDay`), legacy
  (`plannedAt`, stored `TODAY` tag), mixed legacy, completed, archived,
  parent/child with time rolled up into the parent, recurring, a deadline, a
  task in an archived project and both DST changes.
- The 110 `fx-backlog-*` tasks keep the inventory above 100, the native MCP's
  list limit, so a complete inventory read cannot silently adopt that limit.
- The packaged harness gives `plugin.js` a private temporary home and hides
  `/home`, so it never reads or writes a real IPC directory.

## Legacy compatibility

No older app version has qualification evidence in this repository, so
behavior on any version before v20 is unverified. The fake PluginAPI can drop
methods (`createPluginApi({ getDayContext: undefined })`) to test that a
handler detects a missing feature; that is not evidence for a real version.

## Baseline on the suite at this commit

`plugin/v20-baseline.test.js` pins current behavior. The modular bridge and
packaged plugin agree on every case below. Each row is an existing difference
from v20, not a regression; the issue that fixes it updates the test.

| Area | Current behavior | v20 behavior | Issue |
| --- | --- | --- | --- |
| Today | Fixed in #20: `tagId: "TODAY"` uses the app's rule on its logical day (5 tasks). Before: it matched the stored tag ID (2 legacy tasks). | Date-based: 5 tasks on the logical day. | #20 |
| Schedule reads | Fixed in #19: range, health, stale, unscheduled and shaped reads use one normalized schedule (`dueWithTime`, then legacy `plannedAt`, then `dueDay`). Before: `plannedAt` only, so timed v20 tasks looked unscheduled. | Tasks carry `dueWithTime` or `dueDay`. | #19 |
| Archive | Fixed in #15: the Go server calls `POST /tasks/:id/archive` when Local REST is configured. Without REST both plugin projections fail with `UNSUPPORTED_ACTION`. | `POST /tasks/:id/archive`. | #15 |
| Restore | Fixed in #25: the Go server calls `POST /tasks/:id/restore`. Without REST both plugin projections fail with `UNSUPPORTED_ACTION`. | `POST /tasks/:id/restore`. | #25 |
| Tracking | Fixed in #16: the Go server uses `/status` and `/task-control`; the plugin uses `startTracking`/`stopTracking`. Before: start wrote `currentTimestamp`, which v20 ignores. | `startTracking` / `POST /task-control/current`. | #16 |
| Recurrence | Fixed in #22 and #23: the Go server reads and writes `/task-repeat-cfgs`. The plugin's set, update and delete still dispatch actions stock v20 refuses; the router uses them only with `SP_MCP_RECURRENCE_ROUTE=plugin`. | `/task-repeat-cfgs`. | #22, #23 |
| Create with repeat | Creates the task, then reports `recurrenceError`. | Attach through REST. | #24 |
| Time logging | Fixed in #28: the Go server calls `POST`/`PUT /tasks/:id/time`; without REST both plugin projections refuse. Before: add time patched `timeSpent` only. | `POST`/`PUT /tasks/:id/time` update the day. | #28 |
| Worklog | Fixed in #29: counts leaf work once (90 min), includes archived work with `includeArchived:true`, and reports `coverage`. Before: 180 min, archived work skipped. | Count leaf work once. | #29 |
| Capabilities | Lists every registered action, including ones that cannot run. | Report runtime availability. | #26 |

Both projections already return the whole 128-task inventory, and
`allowDoneFallback` marks a task done without archiving it.

Schedule writes (#21) were not in this baseline: they wrote `plannedAt`, and
creating a task with a time dropped the time, because `PluginAPI.addTask` has
no `dueWithTime`. `plugin/v20-schedule-writes.test.js` covers the canonical
writes.
