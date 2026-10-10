# super-productivity-mcp

**A local-first productivity integration that lets AI clients work safely with Super Productivity.** It combines a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server, desktop quick-add launcher, in-app plugin bridge, and agent skill bundle into one versioned suite.

| Challenge | Outcome |
| --- | --- |
| Give AI clients useful task controls without exposing a hosted task service. | A Go MCP server and a Super Productivity plugin communicate through explicit, file-based IPC. |
| Make fast capture practical outside an AI client. | `sp-quick-add` adds desktop task capture through the same bridge and safety model. |
| Keep a growing tool surface dependable. | A single catalog drives the server, plugin, skill bundle, generated docs, and CI drift checks. |

The suite is deliberately **local-first**: task data stays in the user-controlled Super Productivity installation. High-impact scheduling and write operations are dry-run/confirmation oriented, and true archive/restore requires an explicitly configured local API.

**Release readiness:** the repository ships as one compatibility unit (MCP server, plugin, quick-add, and skills). Run `make verify-release` before publishing the initial `v0.1.0` release. Licensed under [MIT](LICENSE).

With this suite you can ask your AI assistant to create tasks, list projects, add tracked time, and more. You can also use `sp-quick-add` to add tasks from your desktop without opening an AI client.

## How it works

```
AI client (Claude / Cursor / VS Code)
    │  MCP JSON-RPC over stdio
    ▼
sp-mcp
    │
    │  file IPC  (inbox / outbox / deadletter)
    ▼
Super Productivity plugin bridge
    ▲
    │  file IPC task.create
    │
sp-quick-add  (Walker prompt)
    │
    ▼
Super Productivity PluginAPI
    │
    ▼
Super Productivity
```

`sp-mcp` and `sp-quick-add` are separate clients of the same plugin bridge. The plugin bridge runs inside Super Productivity and is required for either client to create or read tasks.

## Suite artifacts

| Artifact | What it does | Install target |
| --- | --- | --- |
| `sp-mcp` | MCP server for AI clients | `make install-mcp` |
| `sp-quick-add` | Desktop quick-add launcher | `make install-quick-add` |
| Super Productivity plugin zip | In-app bridge that executes catalog actions | `make install-plugin` or `make package-plugin` |
| `skill/super-productivity-mcp` | Agent skill bundle and diagnostics | `make install-skill` |

`make install` installs the full suite. The per-artifact targets are convenience profiles; the supported release unit is still the suite built from one commit.

## Prerequisites

| Tool | Version |
|------|---------|
| Go | 1.22+ |
| Node.js | 18+ (for the plugin bridge and JS tests) |
| Super Productivity | latest |

## Installation

### Quick install: full suite

One-shot installer — builds the MCP and quick-add binaries, sets up the IPC data directory, installs the skill, packages the plugin zip, and prints the MCP client config:

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
make install
```

Install only one artifact profile when you do not want the full suite:

```bash
make install-mcp        # MCP binary + IPC data directory
make install-quick-add  # quick-add binary + IPC data directory
make install-plugin     # plugin zip only
make install-skill      # agent skill bundle only
```

Those profile targets are thin adapters over `scripts/install-profile.sh`, which owns the install matrix. Use `scripts/install.sh` directly only when you need custom `SKIP_*` combinations.

Honored env vars: `PREFIX`, `BIN_DIR`, `BUILD_DIR`, `DATA_DIR`, `SKILLS_DIR`, `SKIP_BUILD`, `SKIP_MCP`, `SKIP_QUICK_ADD`, `SKIP_SKILL`, `SKIP_DATA_DIR`, `SKIP_PLUGIN_ZIP`. Defaults install to `~/.local/bin` and `~/.local/share/super-productivity-mcp`.

### Manual install

#### 1. Build the binaries

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
go build -o sp-mcp ./cmd/sp-mcp
go build -o sp-quick-add ./cmd/sp-quick-add
```

#### 2. Install the plugin in Super Productivity

1. Run `make package-plugin` to produce the plugin zip (see [Package the plugin](#package-the-super-productivity-plugin) below).
2. Open Super Productivity → **Settings → Plugins**.
3. Click **Upload Plugin** and select the generated zip file.
4. Enable the plugin. It will start watching the IPC directory automatically.

#### 3. Configure your AI client

Copy the example config for your client and adjust the path:

| Client | Config location | Example |
|--------|----------------|---------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `examples/clients/claude/mcp.json` |
| Cursor | `.cursor/mcp.json` in your project | `examples/clients/cursor/mcp.json` |
| VS Code (Copilot) | `.vscode/mcp.json` in your project | `examples/clients/vscode/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json` under `mcp` | `examples/clients/opencode/mcp.json` |

Example (`examples/clients/claude/mcp.json`):

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "bash",
      "args": ["/absolute/path/to/super-productivity-mcp/scripts/run-mcp.sh"],
      "env": {
        "SP_MCP_DATA_DIR": "/home/you/.local/share/super-productivity-mcp",
        "SP_MCP_TIMEOUT": "30s",
        "SP_MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Replace `/absolute/path/to/super-productivity-mcp` with the directory where you cloned this repo.

OpenCode example:

```json
{
  "mcp": {
    "super-productivity": {
      "type": "local",
      "enabled": true,
      "command": ["/home/you/.local/bin/sp-mcp"],
      "environment": {
        "SP_MCP_DATA_DIR": "/home/you/.local/share/super-productivity-mcp",
        "SP_MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SP_MCP_DATA_DIR` | `~/.local/share/super-productivity-mcp` | IPC directory shared between the Go binary and the plugin |
| `SP_MCP_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SP_MCP_TIMEOUT` | `30s` | Per-request timeout (e.g. `10s`, `60s`) |
| `SP_MCP_RETRIES` | `3` | Number of retries on transient bridge errors |
| `SP_LOCAL_REST_URL` / `SUPER_PRODUCTIVITY_REST_URL` | unset | Optional Super Productivity local REST base URL used for true archive operations |
| `SP_LOCAL_REST_TOKEN` | unset | Optional bearer token for the local REST API |

The plugin inside Super Productivity must be configured to use the **same** `SP_MCP_DATA_DIR`.

See [`docs/local-rest.md`](docs/local-rest.md) for Local REST setup, supported tools, fallbacks, and troubleshooting.

## Omarchy / Hyprland quick add

`sp-quick-add` opens a prompt and creates a Super Productivity task through the same plugin IPC bridge as the MCP server. It does not require `sp-mcp`, but it does require the Super Productivity plugin bridge to be installed and enabled. Walker provides the prompt. It supports the same task title short syntax handled by `create_task` (`#tag`, `+project`, `@due`, estimates like `30m`).

```bash
sp-quick-add
sp-quick-add --title "Write docs @today #work 30m"
sp-quick-add --dry-run --title "Smoke quick add @today"
```

Recommended Omarchy/Hyprland binding:

```conf
bindd = SUPER SHIFT, T, Super Productivity quick add, exec, uwsm-app -- /home/you/.local/bin/sp-quick-add
```

## Available tools

The MCP tool and resource surface is catalog-derived. Do not maintain a second
manual list in this README.

- Source of truth: [`internal/catalog/tools.json`](internal/catalog/tools.json)
- Generated Markdown view: [`docs/tools.md`](docs/tools.md)
- Refresh generated docs: `make generate-docs`
- Drift check: `make check-catalogs check-docs`

Safety notes:

- Broad schedule and note writes are dry-run-first where possible. Use `dryRun:false` plus `confirmApply:true` only after inspecting returned diffs.
- True archive/restore uses the optional Local REST API. Without `SP_LOCAL_REST_URL` or `SUPER_PRODUCTIVITY_REST_URL`, `archive_task` only marks done when `allowDoneFallback:true` is explicitly supplied, and `restore_task` is unavailable.
- Recurrence tools require a Super Productivity build whose plugin sandbox allows repeat-config actions. For non-interactive automation, call `update_task_recurrence` without `isAskToUpdateAllTaskInstances` or set it to `false`; setting it to `true` intentionally asks Super Productivity to show the UI confirmation for updating existing task instances.

## Package the Super Productivity plugin

Super Productivity production installs expect a plugin `.zip` that contains at least `manifest.json` and `plugin.js`. This repo can package that for you:

```bash
make package-plugin
# or directly:
bash scripts/package-plugin.sh
```

This writes:

- `dist/plugin/super-productivity-mcp/` — unpacked plugin folder for dev/debugging
- `./super-productivity-mcp-plugin-v<version>.zip` — uploadable plugin archive in the project root

To install in Super Productivity:

1. Open **Settings → Plugins**
2. Click **Upload Plugin**
3. Select the generated zip file from the project root

## Development

### MCP eval scenarios

Read-only MCP evaluation scenarios live in [`docs/evals/mcp-schedule-evals.xml`](docs/evals/mcp-schedule-evals.xml). They document stable agent-use questions for the schedule cleanup, discovery, archive/restore, dry-run, and resource surfaces. `make test` runs `scripts/check-evals.js` to enforce well-formed scenario coverage against the current catalog.

### Run tests

```bash
# All checks (catalog drift + Go unit tests + JS tests + E2E + eval checks)
make test

# Go unit tests only
go test ./...

# JS bridge/plugin tests only
node --test plugin/**/*.test.js plugin/bridge/**/*.test.js

# E2E tests only
go test ./test/e2e -v

# MCP eval scenario checks only
node scripts/check-evals.js

# Regenerate catalog-derived docs
make generate-docs

# Plugin packaging smoke test
make package-plugin

# Smoke-test install profiles
make test-install-profiles

# Full release gate (tests + install-profile smoke + package smoke)
make verify-release
```

### Sync the tool catalog

`internal/catalog/tools.json` is the single source of truth for the tool surface. After editing it, propagate the copies:

```bash
make sync-catalogs
```

CI enforces that the copies never drift from the source (`make check-catalogs`).

### Architecture

- `cmd/sp-mcp/` — MCP binary entrypoint for AI clients
- `cmd/sp-quick-add/` — Omarchy/Hyprland quick-add entrypoint
- `internal/quickadd/` — prompt/task/notification orchestration for quick add
- `internal/catalog/` — tool catalog (SSOT); loaded at startup and mirrored to plugin/skill copies
- `internal/mcpadapter/` — MCP JSON-RPC 2.0 stdio adapter
- `internal/pluginipc/` — shared file-based IPC transport (inbox → processing → outbox / deadletter)
- `internal/config/` — environment/config loading shared by Go clients
- `internal/domain/` — shared suite contract types and interfaces
- `plugin/bridge/` — JavaScript bridge that runs inside Super Productivity
- `skill/super-productivity-mcp/` — agent skill bundle and diagnostics synchronized with the suite catalog

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

### Repository attachment

See [Gitea repository attachment](docs/repository-attachment.md) for the two provider tools, credential handling, companion app patch, and installation requirements.
