# super-productivity-mcp

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup.svg">
  <img src="docs/brand/mark-mono-light.svg" alt="super-productivity-mcp logo. A bridge: two short vertical posts joined by an arc, with a dot at the arc's apex." height="80">
</picture>

A [SUBCULT](https://subcult.tv) project.

super-productivity-mcp lets AI clients such as Claude Desktop, Cursor, VS Code (Copilot) and OpenCode read and change your tasks in [Super Productivity](https://super-productivity.com/), a local task manager. Ask your assistant to create tasks, list projects, log time or clean up a schedule. A desktop quick-add command adds tasks without opening an AI client.

Everything runs on your machine. Task data stays in your Super Productivity installation; nothing goes through a hosted service. The current release is v0.2.0.

## What is in the suite

| Artifact | What it does | Install target |
| --- | --- | --- |
| `sp-mcp` | [Model Context Protocol](https://modelcontextprotocol.io/) server for AI clients (Go, stdio) | `make install-mcp` |
| `sp-quick-add` | Desktop quick-add prompt | `make install-quick-add` |
| Super Productivity plugin | Bridge inside the app that carries out each request | `make install-plugin` or `make package-plugin` |
| `skill/super-productivity-mcp` | Instructions and diagnostics that help an AI client use the tools | `make install-skill` |

Build and install all four from the same commit; they are versioned together.

## How it works

```
AI client (Claude / Cursor / VS Code / OpenCode)
    │  MCP JSON-RPC over stdio
    ▼
sp-mcp ──────────────► Local REST API (optional: archive, restore, tracking, recurrence)
    │
    │  file IPC  (inbox / outbox / deadletter)
    ▼
Super Productivity plugin bridge  ◄── sp-quick-add (file IPC task.create)
    │
    ▼
Super Productivity
```

`sp-mcp` and `sp-quick-add` are separate clients of the same plugin bridge. The plugin must be installed and enabled in Super Productivity for either one to work. Some operations (true archive, restore, time tracking and recurrence) also use Super Productivity's Local REST API; see [docs/local-rest.md](docs/local-rest.md).

## Features

- Create tasks with Super Productivity's short syntax (`#tag`, `+project`, `@due`, estimates like `30m`), with subtasks, due dates and a repeat rule. `literal:true` keeps that syntax as plain text.
- Read, update, complete, archive, restore and delete tasks; complete, update and reschedule tasks in bulk.
- Track time, log time for a day and read the worklog.
- Check schedule health, find stale or unscheduled work, and preview and apply automatic scheduling.
- Manage projects, tags, standalone notes, counters and habit values; read focus-mode state.
- Attach a Gitea repository to a project as an issue provider. This needs a patched Super Productivity build; see [docs/repository-attachment.md](docs/repository-attachment.md).
- Limit what each client can read or change with access scopes (`SP_MCP_SCOPES`).
- `auto_schedule_tasks` and `compact_task_notes` default to a dry run and apply only with `dryRun:false` plus `confirmApply:true`. `bulk_update_tasks`, `bulk_reschedule_tasks` and `clear_schedule_for_day` preview only when you pass `dryRun:true`; `bulk_complete_tasks` has no preview.
- Every tool carries MCP hints (`readOnlyHint`, `destructiveHint` and others) so clients can ask before a destructive call.

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
git clone https://github.com/subculture-collective/super-productivity-mcp.git
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
git clone https://github.com/subculture-collective/super-productivity-mcp.git
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

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SP_MCP_DATA_DIR` | `~/.local/share/super-productivity-mcp` | IPC directory shared between the Go binary and the plugin |
| `SP_MCP_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SP_MCP_TIMEOUT` | `30s` | Per-request timeout (e.g. `10s`, `60s`) |
| `SP_MCP_RETRIES` | `3` | Number of retries on transient bridge errors |
| `SP_MCP_SCOPES` | all scopes | Comma-separated access grant: `read`, `notes`, `create`, `write` (or `all`). See [Access scopes](#access-scopes) |
| `SP_MCP_MAX_RESPONSE_BYTES` | `0` (no cap) | Refuse tool and resource results larger than this many bytes with `RESPONSE_TOO_LARGE` |
| `SP_LOCAL_REST_URL` / `SUPER_PRODUCTIVITY_REST_URL` | unset | Super Productivity's Local REST base URL (stock v20: `http://127.0.0.1:3876`). The MCP server calls it directly for archive, restore, tracking, time logging and recurrence tools |
| `SP_LOCAL_REST_TOKEN` | unset | Bearer token from Settings → Misc → Access Token; stock v20 requires it |
| `SP_LOCAL_REST_TIMEOUT` | `20s` | Per-request timeout for Local REST calls |
| `SP_MCP_RECURRENCE_ROUTE` | unset | `plugin` sends recurrence writes to the legacy plugin path (patched app builds only) |
| `SP_LOCAL_REST_ALLOW_REMOTE` | unset | Set to `1` to allow a non-loopback Local REST host |

The plugin inside Super Productivity must be configured to use the **same** `SP_MCP_DATA_DIR`.

See [`docs/local-rest.md`](docs/local-rest.md) for Local REST setup, supported tools, fallbacks, and troubleshooting.

### Access scopes

`SP_MCP_SCOPES` limits what a client connected to this server can see and do. Leaving it unset grants every scope, which is the behaviour before scopes existed.

| Scope | Grants |
|-------|--------|
| `read` | Read-only tools and the `sp://` resources (except `sp://notes`) |
| `notes` | Task notes in results, `search` matching note text, and, together with `read`, the standalone note tools (`get_notes`, `get_note`) and `sp://notes`. Without it, every `notes` and `content` field is removed from results, searches match titles only, and the note tools are hidden |
| `create` | `create_task`, `create_task_with_subtasks` and `create_note` |
| `write` | Every other tool that changes data |

`get_status`, `check_connection`, `bridge_health`, `debug_directories` and `bridge_capabilities` are always available. Tools outside the grant are left out of `tools/list` and refused with `NOT_PERMITTED`. Unknown scope names are logged and ignored, so a value with no valid scope grants only the status tools. Each tool's scope is listed in [`docs/tools.md`](docs/tools.md).

Examples: `read,notes` for a read-only assistant; `create` for capture only; `read,create` to look things up and add tasks without editing.

The scope is set per server process, so give each client its own MCP server entry when they need different grants. It limits what the MCP client can ask for; it is not a boundary against anything else that can write to `SP_MCP_DATA_DIR` or that runs inside Super Productivity.

## Desktop quick add

`sp-quick-add` opens a prompt and creates a Super Productivity task through the same plugin IPC bridge as the MCP server. It does not require `sp-mcp`, but it does require the Super Productivity plugin bridge to be installed and enabled. The prompt uses Walker, a Linux app launcher, so quick add needs Walker installed. It supports the same task title short syntax handled by `create_task` (`#tag`, `+project`, `@due`, estimates like `30m`).

```bash
sp-quick-add
sp-quick-add --title "Write docs @today #work 30m"
sp-quick-add --dry-run --title "Smoke quick add @today"
```

Example Hyprland binding (Omarchy):

```conf
bindd = SUPER SHIFT, T, Super Productivity quick add, exec, uwsm-app -- /home/you/.local/bin/sp-quick-add
```

## Available tools

The server exposes 69 tools and 12 `sp://` resources. They cover tasks and subtasks, recurrence, archive and restore, time tracking and worklogs, scheduling and schedule cleanup, projects, tags, standalone notes, counters, habits, focus mode, notifications and bridge diagnostics. The full list is generated from the catalog:

- Source of truth: [`internal/catalog/tools.json`](internal/catalog/tools.json)
- Generated Markdown view: [`docs/tools.md`](docs/tools.md)
- Refresh generated docs: `make generate-docs`
- Drift check: `make check-catalogs check-docs`

Safety notes:

- Every tool advertises a `title` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), so clients can ask for confirmation before destructive calls. Read tools state that titles and notes are user data, not instructions.
- `create_task` accepts `dueDate`, `dueTime` and a compact `repeat` (`{ "cycle": "weekly", "every": 2, "weekdays": ["mon", "thu"] }`). Pass `literal:true` to keep `#tag`, `+project`, `@date` and estimates in the title as plain text, which is the safer choice for text that came from somewhere else. On stock v20 `repeat` needs Local REST: the server checks it first, creates the task once, then attaches the recurrence. If the task is created but the recurrence fails, the result carries `taskId` and `recurrenceError` instead of failing, so a retry does not duplicate the task.
- When a non-idempotent write times out after the plugin picked it up, the error is `OUTCOME_UNKNOWN` (not retryable): check the current state before retrying.
- `list_tasks`, `list_projects` and `list_tags` are aliases of `get_tasks`, `get_projects` and `get_tags`, matching Super Productivity's built-in MCP. `get_tasks` also reports `truncated` when `limit` or `offset` left matches out.
- Automatic scheduling and note compaction are dry-run first; apply them with `dryRun:false` plus `confirmApply:true` only after inspecting the returned diffs. Bulk update and reschedule apply immediately unless you pass `dryRun:true`.
- True archive uses Super Productivity's Local REST API, which the MCP server calls itself. Without `SP_LOCAL_REST_URL` or `SUPER_PRODUCTIVITY_REST_URL`, `archive_task` only marks done when `allowDoneFallback:true` is explicitly supplied. `restore_task` also goes through Local REST and has no fallback. A failed REST call is never retried through the plugin; see [`docs/local-rest.md`](docs/local-rest.md).
- Recurrence writes (`set_task_recurrence`, `update_task_recurrence`, `delete_task_recurrence`) go through Local REST and accept only the schedule fields stock v20 can write; other fields fail before anything changes. `SP_MCP_RECURRENCE_ROUTE=plugin` selects the older plugin path, which needs a Super Productivity build that allows repeat-config plugin actions; only there does `isAskToUpdateAllTaskInstances:true` ask the app to update existing instances.

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

Read-only MCP evaluation scenarios live in [`docs/evals/mcp-schedule-evals.xml`](docs/evals/mcp-schedule-evals.xml). They describe questions an AI client should be able to answer for the schedule cleanup, discovery, archive/restore, dry-run, and resource surfaces. `make test` runs `scripts/check-evals.js` to enforce well-formed scenario coverage against the current catalog.

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

Report bugs and request features in [GitHub issues](https://github.com/subculture-collective/super-productivity-mcp/issues). Open pull requests on GitHub against `main`; CI runs `make test` (catalog drift, Go, JavaScript, end-to-end and eval checks) on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and [SECURITY.md](SECURITY.md) for reporting security problems.

## License

[MIT](LICENSE)
