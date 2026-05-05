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

One-shot install (build binary, set up data dir, install skill, package the
Super Productivity plugin zip, print MCP config):

```bash
make install
# or directly:
bash scripts/install.sh
```

Honored env vars: `PREFIX`, `BIN_DIR`, `DATA_DIR`, `SKILLS_DIR`,
`SKIP_BUILD`, `SKIP_SKILL`, `SKIP_DATA_DIR`, `SKIP_PLUGIN_ZIP`. Defaults install to
`~/.local/bin`, `~/.local/share/super-productivity-mcp`, and the first
existing of `~/.agents/skills` or `~/.claude/skills`.

## Package the Super Productivity plugin

Super Productivity production installs expect a plugin `.zip` that contains at
least `manifest.json` and `plugin.js`. This repo can package that for you:

```bash
make package-plugin
# or directly:
bash scripts/package-plugin.sh
```

This writes:

- `dist/plugin/super-productivity-mcp/` — unpacked plugin folder for dev/debugging
- `./super-productivity-mcp-plugin-v<version>.zip` — uploadable plugin archive in the project root

To install in Super Productivity:

1. Open `Settings → Plugins`
2. Click `Upload Plugin`
3. Select the generated zip file from the project root

## Verification

- Go unit tests: `go test ./...`
- JS tests: `node --test plugin/bridge/**/*.test.js`
- E2E test: `go test ./test/e2e -v`
- Plugin packaging smoke test: `make package-plugin`
