# super-productivity-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects AI assistants (Claude, Cursor, VS Code Copilot, and others) to [Super Productivity](https://super-productivity.com/) — the open-source time-tracking and task-management app.

With this integration you can ask your AI assistant to create tasks, list projects, add tracked time, and more, all without leaving your editor or chat interface.

## How it works

```
AI client (Claude / Cursor / VS Code)
    │  MCP JSON-RPC over stdio
    ▼
sp-mcp  (Go binary — this repo)
    │  file IPC  (inbox / outbox / deadletter)
    ▼
plugin.js  (loaded inside Super Productivity)
    │  PluginAPI calls
    ▼
Super Productivity
```

The Go binary speaks the MCP wire protocol to AI clients and bridges requests to a small JavaScript plugin that runs inside Super Productivity via its plugin system.

## Prerequisites

| Tool | Version |
|------|---------|
| Go | 1.22+ |
| Node.js | 18+ (for the plugin bridge and JS tests) |
| Super Productivity | latest |

## Installation

### Quick install (recommended)

One-shot installer — builds the MCP and quick-add binaries, sets up the IPC data directory, installs the skill, packages the plugin zip, and prints the MCP client config:

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
make install
```

Honored env vars: `PREFIX`, `BIN_DIR`, `DATA_DIR`, `SKILLS_DIR`, `SKIP_BUILD`, `SKIP_SKILL`, `SKIP_DATA_DIR`, `SKIP_PLUGIN_ZIP`. Defaults install to `~/.local/bin` and `~/.local/share/super-productivity-mcp`.

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

The plugin inside Super Productivity must be configured to use the **same** `SP_MCP_DATA_DIR`.

## Omarchy / Hyprland quick add

`sp-quick-add` opens a prompt and creates a Super Productivity task through the same plugin IPC bridge as the MCP server. Walker remains the default prompt. A themeable GTK/Wayland popup is available with `--prompt popup`. Both support the same task title short syntax handled by `create_task` (`#tag`, `+project`, `@due`, estimates like `30m`).

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

## Available tools

| MCP tool | What it does |
|----------|-------------|
| `create_task` | Create a new task in Super Productivity. Supports short syntax in title: `#tag`, `+project`, `@due`, estimates like `30m` or `1h/2h`. |
| `get_tasks` | List tasks from Super Productivity |
| `create_task_with_subtasks` | Create a parent task and subtasks in one operation. Supports short syntax in parent and subtask titles. |
| `get_task` | Get a specific task by ID |
| `update_task` | Update task fields |
| `complete_task` | Mark a task as done |
| `uncomplete_task` | Unmark a task as done |
| `archive_task` | Archive a task |
| `delete_task` | Delete a task permanently when the Super Productivity plugin runtime supports `deleteTask` |
| `add_time_to_task` | Add tracked time (milliseconds) |
| `start_task` | Start time tracking on a task, stopping any other active task first |
| `stop_task` | Stop the currently running time tracker; idempotent when nothing is running |
| `get_current_task` | Get the currently tracked task, or null when no timer is running |
| `get_worklog` | Summarize tracked task time for a date range |
| `bulk_complete_tasks` | Mark multiple tasks complete with per-task partial success results |
| `bulk_update_tasks` | Update multiple tasks with per-task partial success results |
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
| `bridge_health` | Check that the plugin bridge is alive |
| `check_connection` | Upstream-compatible alias for checking whether Super Productivity and the plugin bridge are responding |
| `debug_directories` | Show resolved plugin bridge IPC directories for diagnostics |
| `bridge_capabilities` | List supported bridge actions |

The full schema for each tool lives in [`internal/catalog/tools.json`](internal/catalog/tools.json).

## Available resources

| MCP resource | What it returns |
|--------------|-----------------|
| `sp://projects` | All Super Productivity projects as JSON |
| `sp://tags` | All Super Productivity tags as JSON |
| `sp://tasks/today` | Incomplete tasks planned for today as JSON |
| `sp://tasks/overdue` | Incomplete overdue tasks as JSON |

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

### Run tests

```bash
# All checks (catalog drift + Go unit tests + JS tests + E2E)
make test

# Go unit tests only
go test ./...

# JS bridge/plugin tests only
node --test plugin/**/*.test.js plugin/bridge/**/*.test.js

# E2E tests only
go test ./test/e2e -v

# Plugin packaging smoke test
make package-plugin
```

### Sync the tool catalog

`internal/catalog/tools.json` is the single source of truth for the tool surface. After editing it, propagate the copies:

```bash
make sync-catalogs
```

CI enforces that the copies never drift from the source (`make check-catalogs`).

### Architecture

- `cmd/sp-mcp/` — binary entrypoint
- `cmd/sp-quick-add/` — Omarchy/Hyprland quick-add entrypoint
- `internal/quickadd/` — prompt/task/notification orchestration for quick add
- `internal/catalog/` — tool catalog (SSOT); loaded at startup
- `internal/mcpadapter/` — MCP JSON-RPC 2.0 stdio adapter
- `internal/pluginipc/` — file-based IPC transport (inbox → processing → outbox / deadletter)
- `internal/config/` — environment/config loading
- `internal/domain/` — shared types and interfaces
- `plugin/bridge/` — JavaScript plugin that runs inside Super Productivity

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
