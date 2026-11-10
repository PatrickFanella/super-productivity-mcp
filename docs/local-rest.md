# Local REST integration

The MCP server normally reaches Super Productivity through the plugin's file
IPC. Some operations have no plugin API equivalent and need Super
Productivity's Local REST API instead. The MCP server calls that API itself
for the tools marked "Go server" below; see
[ADR 0003](adr/0003-local-rest-routing.md).

## Enable the API

In Super Productivity v20: **Settings → Misc → Enable local REST API**. The
same panel shows the **Access Token**. The API listens only on
`http://127.0.0.1:3876` and needs the token on every request.

## Environment variables

Set these in the MCP client's environment for `sp-mcp`, next to
`SP_MCP_DATA_DIR`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `SP_LOCAL_REST_URL` | For REST tools | Base URL. Stock v20: `http://127.0.0.1:3876`, without `/api`. |
| `SUPER_PRODUCTIVITY_REST_URL` | No | Alias used when `SP_LOCAL_REST_URL` is unset. |
| `SP_LOCAL_REST_TOKEN` | With v20 | Access token, sent as `Authorization: Bearer <token>`. |
| `SP_LOCAL_REST_TIMEOUT` | No | Per-request timeout, default `20s`. |
| `SP_MCP_RECURRENCE_ROUTE` | No | `plugin` sends recurrence writes to the plugin's repeat-config dispatch instead of REST. Stock v20 refuses that dispatch; use it only on a patched build that allows it. |
| `SP_LOCAL_REST_ALLOW_REMOTE` | No | Set to `1` to allow a host other than `127.0.0.1` or `localhost`, for example through a tunnel you set up. The app itself listens only on `127.0.0.1`. |

The URL is used as written. An older URL such as `http://127.0.0.1:4767/api`
is not rewritten; stock v20 answers it with "connection refused" or
`LOCAL_REST_UNSUPPORTED_ROUTE`.

## How requests are protected

- The token is sent only to the configured URL. Requests ignore `HTTP_PROXY`
  and similar variables and never follow redirects.
- No error message contains the token or a response body.
- A URL with a username, password, query or fragment is refused, and so is a
  token with control characters.
- Without `SP_LOCAL_REST_ALLOW_REMOTE`, `localhost` must resolve to a loopback
  address when the connection is made.
- Error messages from the app's own server errors (5xx) are dropped; only
  their code is kept. Messages from rejected requests (4xx) are kept, cut to
  200 characters.

## Tools that use Local REST

| Tool | Route | Who calls it | Without REST |
|------|-------|--------------|--------------|
| `archive_task` | `POST /tasks/:id/archive` | Go server | Errors with `UNSUPPORTED_ACTION` unless `allowDoneFallback:true`, which marks the task done instead of archiving it. |
| `restore_task` | `POST /tasks/:id/restore` | Go server | `UNSUPPORTED_ACTION`; no fallback. |
| `get_task_recurrences` | `GET /task-repeat-cfgs` | Go server | Plugin reads `PluginAPI.getAppState()`. |
| `get_task_recurrence` | `GET /tasks/:id`, then `GET /task-repeat-cfgs/:id` | Go server | Plugin reads `PluginAPI.getAppState()`. |
| `update_task` with a deadline field | `PATCH /tasks/:id` with the whole update | Go server | `UNSUPPORTED_ACTION`: a plain plugin update would skip the app's deadline planning. |
| `create_task` with `repeat` | `GET /status`, plugin create, then `POST /task-repeat-cfgs` | Go server | `UNSUPPORTED_ACTION` before anything is created, unless `SP_MCP_RECURRENCE_ROUTE=plugin`. |
| `set_task_recurrence` | `POST /task-repeat-cfgs` | Go server | `UNSUPPORTED_ACTION`, unless `SP_MCP_RECURRENCE_ROUTE=plugin`. |
| `update_task_recurrence` | `GET /tasks/:id`, then `PATCH /task-repeat-cfgs/:id` | Go server | Same. |
| `delete_task_recurrence` | `GET /tasks/:id`, then `DELETE /task-repeat-cfgs/:id` | Go server | Same. |
| `start_task` | `GET /tasks/:id`, `GET /status`, `POST /task-control/current` | Go server | Plugin calls `PluginAPI.startTracking`. |
| `stop_task` | `GET /status`, `POST /task-control/stop` | Go server | Plugin calls `PluginAPI.stopTracking`. |
| `get_focus_state` | `GET /focus` | Go server | `UNSUPPORTED_ACTION`: the plugin API has no focus read. Read-only; there are no focus controls. |
| `get_habit_history` | `GET /simple-counters` | Plugin first (`getAllSimpleCounters`); Go server when the plugin lacks it | `getAllSimpleCounters`. |
| `set_habit_value_for_day` | `PUT /simple-counters/:id/value` | Go server | `UNSUPPORTED_ACTION`. |
| `get_current_task` | `GET /status` | Go server | `UNSUPPORTED_ACTION`: the plugin API cannot read the tracked task. |
| `add_time_to_task` | `GET /tasks/:id`, then `POST /tasks/:id/time` | Go server | `UNSUPPORTED_ACTION`: the plugin API cannot update a day's time record. |
| `set_task_time_for_day` | `GET /tasks/:id`, then `PUT /tasks/:id/time` | Go server | Same. |

`start_task` refuses to take tracking over from another device that is
live-tracking through SuperSync (`TRACKING_ON_OTHER_DEVICE`) unless the call
passes `takeover: true`; `get_current_task` shows that session as
`trackingOnOtherDevice`. Starting a parent tracks its first unfinished
subtask, and `trackedTaskId` says which.

Deadlines (`deadlineDay`, `deadlineWithTime`, `deadlineRemindAt`) are true
due dates, separate from planned work. An `update_task` call with any of them
is validated as a whole and sent as one `PATCH /tasks/:id`, never split. The
app then applies the deadline dialog's rules: a changed deadline drops its old
reminder unless a new one is given, and a deadline that is today can move
`dueDay` to today and clear `dueWithTime` and its reminder. Schedule tools
(`clear_schedule_for_day`, `plan_tasks_for_today`, the bulk tools) never touch
deadlines.

Time logging needs a date. Without one, the MCP server asks the plugin for
the app's logical day, which follows its start-of-next-day setting; if the
plugin cannot report it, the call fails with `DAY_CONTEXT_UNAVAILABLE`
instead of using the host clock. Only leaf tasks take time: a parent's time
is the sum of its subtasks'. `add_time_to_task` adds and is not safe to
retry after `OUTCOME_UNKNOWN`; `set_task_time_for_day` sets a day's total and
is.

Recurrence writes accept only the fields stock v20 can write: `quickSetting`,
`startDate`, `repeatCycle`, `repeatEvery`, the weekdays (those three with
`quickSetting: "CUSTOM"`), `isPaused` and `skipOverdue`. Any other field fails
with `UNSUPPORTED_FIELD` before a request is sent. Deleting a recurrence keeps
its tasks.

Recurrence reads include paused configs. Their `writableFields` result names
the fields a schedule edit can change on each adapter; on stock v20 the plugin
cannot write repeat configs at all.

Only a top-level task can be archived; its subtasks go with it. Archiving a
subtask returns `INVALID_REQUEST`. Restoring a task that is not in the archive
returns `TASK_NOT_FOUND`; restore brings its archived subtasks back too.

## Client config example

```json
{
  "mcp": {
    "super-productivity": {
      "type": "local",
      "enabled": true,
      "command": ["/home/you/.local/bin/sp-mcp"],
      "environment": {
        "SP_MCP_DATA_DIR": "/home/you/.local/share/super-productivity-mcp",
        "SP_LOCAL_REST_URL": "http://127.0.0.1:3876",
        "SP_LOCAL_REST_TOKEN": "<access token from Settings → Misc>"
      }
    }
  }
}
```

## Status and capabilities

`get_status` probes the plugin bridge and Local REST at the same time, each
for at most three seconds, and reports `readiness`: `ready` when every
configured adapter answered, `partial` when only some did, `unavailable`
when none did. A plugin that stopped answering therefore shows as `partial`
instead of hanging the call, and REST-routed tools keep working.
`bridge_capabilities` lists, per action, the adapter it uses, whether that
adapter answered, and known limitations. `bridge_health` checks only the
plugin bridge.

## Errors

A REST-routed tool never falls back to the plugin after a REST error.

| Code | Meaning | What to do |
|------|---------|------------|
| `UNSUPPORTED_ACTION` | Local REST is not configured for an operation that needs it. | Set `SP_LOCAL_REST_URL` and `SP_LOCAL_REST_TOKEN`, or use the documented fallback. |
| `LOCAL_REST_MISCONFIGURED` | The URL or token is set but unusable (not absolute, not `127.0.0.1`/`localhost`, contains credentials, token with control characters). The server logs a warning at startup. | Fix the setting. |
| `LOCAL_REST_UNAVAILABLE` | Nothing was done: the connection was refused, the API is switched off, the app is still starting, or too many requests are open. Retryable. | Start the app or enable the API, then retry. |
| `LOCAL_REST_UNAUTHORIZED` | The token is missing or wrong. | Copy the token from Settings → Misc and restart the client. |
| `LOCAL_REST_UNSUPPORTED_ROUTE` | This app version does not offer the route, or the URL has a wrong prefix. | Use `http://127.0.0.1:3876` on v20. |
| `OUTCOME_UNKNOWN` | A change was sent, but no clear answer came back (timeout, server error, unreadable reply). It may have been applied. | Check the task, for example with `get_tasks source:"archived"`, before retrying. |
| `TASK_NOT_FOUND`, `INVALID_REQUEST`, `UNSUPPORTED_FIELD` | The request was rejected and nothing changed. A task ID of `.` or `..` is refused before sending. | Fix the request. |

## Safety notes

True archive and restore change where Super Productivity stores tasks. Use
`get_tasks` with `source:"archived"` or `source:"all"` afterwards to verify
the result.
