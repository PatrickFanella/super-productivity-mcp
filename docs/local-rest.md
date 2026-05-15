# Local REST integration

The MCP bridge normally talks to the Super Productivity plugin through file IPC. Some task operations need the optional Super Productivity Local REST API because the plugin API does not expose equivalent archive/restore and task-control endpoints.

## Environment variables

Configure these in the MCP client environment, next to `SP_MCP_DATA_DIR`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `SP_LOCAL_REST_URL` | Optional | Preferred Local REST base URL, for example `http://127.0.0.1:4767/api`. |
| `SUPER_PRODUCTIVITY_REST_URL` | Optional | Backward-compatible alias used when `SP_LOCAL_REST_URL` is unset. |
| `SP_LOCAL_REST_TOKEN` | Optional | Bearer token sent as `Authorization: Bearer <token>` when the Local REST API requires auth. |

Use the same base URL shape that reaches Super Productivity's local REST routes. Do not include a trailing slash; the bridge removes it if present.

## Tools that use Local REST

| Tool | REST route | Fallback without REST |
|------|------------|-----------------------|
| `archive_task` | `POST /tasks/:id/archive` | Errors unless `allowDoneFallback:true`, which marks the task done instead of true archive. |
| `restore_task` | `POST /tasks/:id/restore` | No fallback; returns `UNSUPPORTED_ACTION`. |
| `start_task` | `POST /tasks/:id/start` | Falls back to plugin mutation of `currentTimestamp`. |
| `stop_task` | `POST /task-control/stop` | Falls back to clearing plugin `currentTimestamp`. |
| `get_current_task` | `GET /task-control/current` | Falls back to scanning active plugin tasks for `currentTimestamp`. |

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
        "SP_LOCAL_REST_URL": "http://127.0.0.1:4767/api",
        "SP_LOCAL_REST_TOKEN": "optional-token"
      }
    }
  }
}
```

## Troubleshooting

- `UNSUPPORTED_ACTION`: Local REST is not configured for an operation that requires it. Set `SP_LOCAL_REST_URL` or use the documented fallback when available.
- `401` or `403`: `SP_LOCAL_REST_TOKEN` is missing or wrong. Update the token in the MCP client config and restart the client.
- `404`: The base URL is probably wrong or points above/below the API prefix. Try the same URL plus `/tasks` in a browser or HTTP client.
- `connection refused`: Super Productivity is not running, Local REST is disabled, or the host/port is wrong.
- `archive_task` marked done instead of archived: the caller passed `allowDoneFallback:true`; remove it and configure Local REST for true archive semantics.

## Safety notes

True archive and restore change where Super Productivity stores tasks. Use `get_tasks` with `source:"archived"` or `source:"all"` after archive/restore to verify the result.
