# Super Productivity plugin IPC v2

## Versioning and compatibility

- `protocolVersion` is required in every envelope.
- Major version mismatch is rejected.
- Current version: `2.0`.

## Envelope types

### Request

```json
{
  "protocolVersion": "2.0",
  "id": "req_01H...",
  "type": "request",
  "action": "task.create",
  "sentAt": "2026-04-25T12:00:00Z",
  "payload": {},
  "meta": {
    "client": "sp-mcp",
    "clientVersion": "0.1.0"
  }
}
```

### Response

```json
{
  "protocolVersion": "2.0",
  "id": "req_01H...",
  "type": "response",
  "status": "ok",
  "result": {},
  "error": null,
  "meta": {
    "handledAt": "2026-04-25T12:00:01Z"
  }
}
```

### Event

```json
{
  "protocolVersion": "2.0",
  "id": "evt_01H...",
  "type": "event",
  "event": "tasks.changed",
  "payload": {},
  "meta": {}
}
```

## Typed error

```json
{
  "code": "TASK_NOT_FOUND",
  "message": "Task `abc` not found",
  "retryable": false,
  "details": {}
}
```

## Directory lifecycle

Required directories under `SP_MCP_DATA_DIR` (or platform default):

- `inbox/`
- `processing/`
- `outbox/`
- `events/`
- `deadletter/`

### Write and processing rules

1. Go writes request atomically into `inbox/` as `<id>.json`.
2. Plugin atomically moves request to `processing/<id>.json` before execution.
3. Plugin writes response atomically to `outbox/<id>.json`.
4. Plugin removes corresponding `processing/<id>.json` after final write.
5. Failed request decoding/execution is moved to `deadletter/` with an error envelope.

## Handshake actions

- `bridge.health`
- `bridge.checkConnection`
- `bridge.debugDirectories`
- `bridge.capabilities`

Capabilities response shape:

```json
{
  "supportedActions": ["task.create", "task.list"],
  "pluginVersion": "x.y.z",
  "spVersion": "optional"
}
```

## MCP resources

The Go MCP adapter exposes read-only resources and fulfills them by dispatching
normal bridge actions over IPC:

| Resource URI | Bridge action | Payload |
| --- | --- | --- |
| `sp://projects` | `project.list` | `{}` |
| `sp://tags` | `tag.list` | `{}` |
| `sp://tasks/today` | `task.list` | `{ "includeDone": false, "plannedForToday": true }` |
| `sp://tasks/overdue` | `task.list` | `{ "includeDone": false, "overdue": true }` |

## Timeout/retry policy

- Implemented by Go client only.
- Plugin side should keep polling deterministic and stateless.
