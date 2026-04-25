# super-productivity-mcp

Go + JS bridge rewrite of the Super Productivity MCP integration.

## Architecture

- Go binary (`cmd/sp-mcp`) provides stdio-facing MCP adapter and service orchestration.
- JS plugin bridge (`plugin/bridge`) translates protocol v2 actions into `PluginAPI` calls.
- File IPC directories: `inbox/`, `processing/`, `outbox/`, `events/`, `deadletter/`.

## Environment variables

- `SP_MCP_DATA_DIR` (optional): base data/IPC directory.
- `SP_MCP_LOG_LEVEL` (optional): `debug|info|warn|error`.
- `SP_MCP_TIMEOUT` (optional): duration (`30s`, `10s`, etc.).
- `SP_MCP_RETRIES` (optional): integer retry count.

## Run

- Non-interactive launcher: `scripts/run-mcp.sh`.
- Client examples: `examples/clients/{claude,cursor,vscode}/mcp.json`.

## Verification

- Go unit tests: `go test ./...`
- JS tests: `node --test plugin/bridge/**/*.test.js`
- E2E test: `go test ./test/e2e -v`
