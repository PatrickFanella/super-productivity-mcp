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

## Install

One-shot install (build binary, set up data dir, install skill, print MCP config):

```bash
make install
# or directly:
bash scripts/install.sh
```

Honored env vars: `PREFIX`, `BIN_DIR`, `DATA_DIR`, `SKILLS_DIR`,
`SKIP_BUILD`, `SKIP_SKILL`, `SKIP_DATA_DIR`. Defaults install to
`~/.local/bin`, `~/.local/share/super-productivity-mcp`, and the first
existing of `~/.agents/skills` or `~/.claude/skills`.

## Verification

- Go unit tests: `go test ./...`
- JS tests: `node --test plugin/bridge/**/*.test.js`
- E2E test: `go test ./test/e2e -v`
