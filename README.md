# super-productivity-mcp

An integrated Super Productivity automation suite with a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server, a desktop quick-add launcher, a Super Productivity plugin bridge, and an agent skill bundle.

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
sp-quick-add  (desktop prompt / popup)
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
| `sp-quick-add` + `quickadd-popup/` | Desktop quick-add launcher and popup assets | `make install-quick-add` |
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
make install-quick-add  # quick-add binary + popup assets + IPC data directory
make install-plugin     # plugin zip only
make install-skill      # agent skill bundle only
```

Honored env vars: `PREFIX`, `BIN_DIR`, `SHARE_DIR`, `BUILD_DIR`, `DATA_DIR`, `SKILLS_DIR`, `SKIP_BUILD`, `SKIP_MCP`, `SKIP_QUICK_ADD`, `SKIP_SKILL`, `SKIP_DATA_DIR`, `SKIP_PLUGIN_ZIP`. Defaults install to `~/.local/bin` and `~/.local/share/super-productivity-mcp`.

If you override `SHARE_DIR` outside the default prefix layout, `sp-quick-add --prompt popup` will only find its popup assets when you also set `SP_QUICK_ADD_POPUP_DIR` or pass `--popup-dir`.

### Manual install

#### 1. Build the binaries

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
go build -o sp-mcp ./cmd/sp-mcp
go build -o sp-quick-add ./cmd/sp-quick-add
```

If you want `sp-quick-add --prompt popup` without running `make install`, either run it from the repository root or set `SP_QUICK_ADD_POPUP_DIR` to the `quickadd-popup/` directory. The installer copies those assets to `~/.local/share/super-productivity-mcp/quickadd-popup`.

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

`sp-quick-add` opens a prompt and creates a Super Productivity task through the same plugin IPC bridge as the MCP server. It does not require `sp-mcp`, but it does require the Super Productivity plugin bridge to be installed and enabled. Walker remains the default prompt. A themeable GTK/Wayland popup is available with `--prompt popup`. Both support the same task title short syntax handled by `create_task` (`#tag`, `+project`, `@due`, estimates like `30m`).

```bash
sp-quick-add
sp-quick-add --prompt popup
sp-quick-add --title "Write docs @today #work 30m"
sp-quick-add --dry-run --title "Smoke quick add @today"
```

Recommended Omarchy/Hyprland binding:

```conf
bindd = SUPER SHIFT, T, Super Productivity quick add, exec, uwsm-app -- /home/you/.local/bin/sp-quick-add
```

The prompt layer is intentionally isolated. Walker is the default today; richer prompt UIs can be added later without changing IPC or the Hyprland binding.

To bind the popup instead of Walker:

```conf
bindd = SUPER SHIFT, T, Super Productivity quick add, exec, uwsm-app -- /home/you/.local/bin/sp-quick-add --prompt popup
```

Popup theme resolution order:

1. `SP_QUICK_ADD_THEME_CSS`
2. `~/.config/super-productivity-mcp/quick-add/style.css`
3. `~/.config/omarchy/current/theme/colors.toml`
4. built-in fallback CSS

Popup asset lookup order:

1. `SP_QUICK_ADD_POPUP_DIR`
2. `quickadd-popup/` under the current working directory
3. `<install-prefix>/share/super-productivity-mcp/quickadd-popup`

If your popup assets live somewhere else because `SHARE_DIR` was customized, set `SP_QUICK_ADD_POPUP_DIR` or use `--popup-dir` with `sp-quick-add --prompt popup`.

## Available tools

| MCP tool | What it does |
|----------|-------------|
| `create_task` | Create a new task in Super Productivity. Supports short syntax in title: `#tag`, `+project`, `@due`, estimates like `30m` or `1h/2h`. |
| `get_tasks` | List tasks from Super Productivity; supports active/archived/all sources when archived tasks API is available |
| `get_archived_tasks` | List archived tasks when the plugin runtime supports archived task reads |
| `get_current_context_tasks` | List tasks from Super Productivity's current context when available |
| `create_task_with_subtasks` | Create a parent task and subtasks in one operation. Supports short syntax in parent and subtask titles. |
| `get_task` | Get a specific task by ID |
| `update_task` | Update task fields |
| `complete_task` | Mark a task as done |
| `uncomplete_task` | Unmark a task as done |
| `archive_task` | Archive a task via optional local REST API; can explicitly fall back to marking done |
| `restore_task` | Restore an archived task through the optional local REST API |
| `delete_task` | Delete a task permanently when the Super Productivity plugin runtime supports `deleteTask` |
| `add_time_to_task` | Add tracked time (milliseconds) |
| `start_task` | Start time tracking on a task, stopping any other active task first |
| `stop_task` | Stop the currently running time tracker; idempotent when nothing is running |
| `get_current_task` | Get the currently tracked task, or null when no timer is running |
| `get_worklog` | Summarize tracked task time for a date range |
| `bulk_complete_tasks` | Mark multiple tasks complete with per-task partial success results |
| `bulk_update_tasks` | Update multiple tasks with per-task partial success results and optional dry-run diffs |
| `bulk_reschedule_tasks` | Update only schedule fields (`plannedAt`, `dueDay`, `timeEstimate`) for multiple tasks with dry-run diffs |
| `clear_schedule_for_day` | Clear `plannedAt` for tasks planned on a local date, optionally clearing matching `dueDay` values |
| `get_schedule_health` | Summarize schedule hygiene counts and concise task lists for cleanup planning |
| `get_schedule_range` | Read planned tasks grouped by local date for a date range |
| `find_stale_schedule` | Find active tasks planned or due before a cutoff date |
| `find_unscheduled_active_tasks` | Find active tasks with no `plannedAt` and no `dueDay` using project/tag/estimate filters |
| `make_planned_at` | Convert a local date/time and timezone into a `plannedAt` timestamp |
| `auto_schedule_tasks` | Dry-run-first scheduler for unscheduled active tasks using daily capacity |
| `compact_task_notes` | Replace oversized task notes with caller-provided compact notes using dry-run-first size diffs |
| `plan_tasks_for_today` | Plan or unplan multiple tasks for today using `plannedAt` |
| `add_tag_to_task` | Add one tag to a task without replacing existing tags; idempotent if already present |
| `remove_tag_from_task` | Remove one tag from a task without replacing other tags; errors if absent |
| `move_task_to_project` | Move a top-level task to a project; rejects subtasks |
| `reorder_task` | Reorder tasks within a project or tag context |
| `reorder_tasks` | Upstream-compatible alias for reordering tasks within a project, tag, or parent task context |
| `get_projects` | List all projects |
| `create_project` | Create a new project |
| `update_project` | Update a project |
| `get_tags` | List all tags |
| `create_tag` | Create a new tag |
| `update_tag` | Update a tag |
| `show_notification` | Show a notification in Super Productivity |
| `notify_user` | Send a Super Productivity notification through PluginAPI.notify when available |
| `get_counters` | List all plugin counters when available |
| `get_counter` | Read one plugin counter by id |
| `set_counter` | Set one plugin counter by id |
| `increment_counter` | Increment one plugin counter by id |
| `decrement_counter` | Decrement one plugin counter by id |
| `delete_counter` | Delete one plugin counter by id |
| `bridge_health` | Check that the plugin bridge is alive |
| `check_connection` | Upstream-compatible alias for checking whether Super Productivity and the plugin bridge are responding |
| `debug_directories` | Show resolved plugin bridge IPC directories for diagnostics |
| `bridge_capabilities` | List supported bridge actions |

The full schema for each tool lives in [`internal/catalog/tools.json`](internal/catalog/tools.json). A generated Markdown view lives in [`docs/tools.md`](docs/tools.md); refresh it with `make generate-docs`.

Safety notes:

- Broad schedule and note writes are dry-run-first where possible. Use `dryRun:false` plus `confirmApply:true` only after inspecting returned diffs.
- True archive/restore uses the optional Local REST API. Without `SP_LOCAL_REST_URL` or `SUPER_PRODUCTIVITY_REST_URL`, `archive_task` only marks done when `allowDoneFallback:true` is explicitly supplied, and `restore_task` is unavailable.

## Available resources

| MCP resource | What it returns |
|--------------|-----------------|
| `sp://projects` | All Super Productivity projects as JSON |
| `sp://tags` | All Super Productivity tags as JSON |
| `sp://tasks/active` | Incomplete active tasks as JSON |
| `sp://tasks/archived` | Archived tasks when the plugin runtime supports archived task reads |
| `sp://tasks/current-context` | Incomplete tasks from the current Super Productivity context when available |
| `sp://tasks/today` | Incomplete tasks planned for today as JSON |
| `sp://tasks/overdue` | Incomplete overdue tasks as JSON |
| `sp://tasks/unscheduled` | Active top-level tasks with no planned date or due date as JSON |
| `sp://schedule/today` | Incomplete tasks planned today with concise synthetic metadata as JSON |
| `sp://schedule/health` | Schedule hygiene counts and concise task lists as JSON |
| `sp://counters` | All Super Productivity plugin counters when available |

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
