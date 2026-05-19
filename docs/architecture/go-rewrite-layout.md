# Suite package and contract layout

## Package boundaries

- `internal/domain`: shared suite contract types, including the plugin IPC protocol version, `Bridge` interface, request/response structs, and typed errors.
- `internal/catalog`: canonical tool catalog (SSOT for MCP name ↔ JS action ↔ schema), loaded from `internal/catalog/tools.json` and mirrored to `plugin/bridge/tool-catalog.json` and `skill/super-productivity-mcp/data/tool-catalog.json`.
- `internal/pluginipc`: file transport implementation for plugin bridge; owns the request lifecycle (inbox → outbox/deadletter, stall vs timeout distinction). Used by both `sp-mcp` and `sp-quick-add`.
- `internal/mcpadapter`: stdio adapter; dispatches `tools/call` directly to `Bridge.Call` using the catalog. No service layer.
- `internal/quickadd`: prompt/task/notification orchestration for `sp-quick-add`; depends on a task creator interface and uses the plugin IPC bridge in the CLI adapter.
- `internal/config`: env/path/timeout/poll-interval config shared by Go clients.
- `internal/logging`: logger construction.
- `internal/version`: build metadata + `MCPProtocolVersion` and `EnvelopeProtocolVersion` constants.

## Key interfaces

```go
type Bridge interface {
    Call(ctx context.Context, req Request) (Response, error)
}
```

The bridge surface is intentionally minimal. Health and capabilities are
ordinary actions in the catalog (`bridge.health`, `bridge.capabilities`),
dispatched the same way as everything else.

## Design constraints

- The MCP adapter must not know file transport details.
- The catalog is the single source of truth for the action surface; drift between catalog and JS handlers is a load-time failure (see `plugin/bridge/actions/index.js`).
- `make check-catalogs` enforces that the synced catalog copies are in lock-step with the Go-side SSOT.
- Syntax parsing remains in plugin/SP path for now.
