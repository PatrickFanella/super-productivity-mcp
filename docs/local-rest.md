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
| `SP_LOCAL_REST_ALLOW_REMOTE` | No | Set to `1` to allow a host other than `127.0.0.1`, `::1` or `localhost`, for example through a tunnel you set up. |

The URL is used as written. An older URL such as `http://127.0.0.1:4767/api`
is not rewritten; stock v20 answers it with "connection refused" or
`LOCAL_REST_UNSUPPORTED_ROUTE`.

## How requests are protected

- The token is sent only to the configured URL. Requests ignore `HTTP_PROXY`
  and similar variables and never follow redirects.
- No error message contains the token or a response body. Upstream error
  messages are kept only from the app's own `{ok:false, error}` replies, cut
  to 200 characters.
- A URL with a username, password, query or fragment is refused.

## Tools that use Local REST

| Tool | Route | Who calls it | Without REST |
|------|-------|--------------|--------------|
| `archive_task` | `POST /tasks/:id/archive` | Go server | Errors with `UNSUPPORTED_ACTION` unless `allowDoneFallback:true`, which marks the task done instead of archiving it. |
| `restore_task` | `POST /tasks/:id/restore` | Modular plugin only | `UNSUPPORTED_ACTION`. |
| `start_task` | `POST /tasks/:id/start` | Modular plugin only | Plugin writes `currentTimestamp`. |
| `stop_task` | `POST /task-control/stop` | Modular plugin only | Plugin clears `currentTimestamp`. |
| `get_current_task` | `GET /task-control/current` | Modular plugin only | Plugin scans tasks for `currentTimestamp`. |

"Modular plugin only" rows read `SP_LOCAL_REST_URL` from the plugin's own
process, which the installed packaged plugin does not do. Roadmap issues #16
and #25 move them to the Go server.

Only a top-level task can be archived; its subtasks go with it. Archiving a
subtask returns `INVALID_REQUEST`.

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

## Errors

A REST-routed tool never falls back to the plugin after a REST error.

| Code | Meaning | What to do |
|------|---------|------------|
| `UNSUPPORTED_ACTION` | Local REST is not configured for an operation that needs it. | Set `SP_LOCAL_REST_URL` and `SP_LOCAL_REST_TOKEN`, or use the documented fallback. |
| `LOCAL_REST_MISCONFIGURED` | The URL is set but unusable (not absolute, not loopback, contains credentials). The server logs a warning at startup. | Fix the URL. |
| `LOCAL_REST_UNAVAILABLE` | Nothing was done: the connection was refused, the API is switched off, the app is still starting, or too many requests are open. Retryable. | Start the app or enable the API, then retry. |
| `LOCAL_REST_UNAUTHORIZED` | The token is missing or wrong. | Copy the token from Settings → Misc and restart the client. |
| `LOCAL_REST_UNSUPPORTED_ROUTE` | This app version does not offer the route, or the URL has a wrong prefix. | Use `http://127.0.0.1:3876` on v20. |
| `OUTCOME_UNKNOWN` | A change was sent, but no clear answer came back (timeout, server error, unreadable reply). It may have been applied. | Check the task, for example with `get_tasks source:"archived"`, before retrying. |
| `TASK_NOT_FOUND`, `INVALID_REQUEST`, `UNSUPPORTED_FIELD` | The app rejected the request; nothing changed. | Fix the request. |

## Safety notes

True archive and restore change where Super Productivity stores tasks. Use
`get_tasks` with `source:"archived"` or `source:"all"` afterwards to verify
the result.
