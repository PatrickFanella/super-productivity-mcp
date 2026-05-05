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

### 1. Build the binary

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
go build -o sp-mcp ./cmd/sp-mcp
```

### 2. Install the plugin in Super Productivity

1. Open Super Productivity → **Settings → Plugins**.
2. Click **Add plugin from file** and select `plugin.js` from this repository.
3. Enable the plugin. It will start watching the IPC directory automatically.

### 3. Configure your AI client

Copy the example config for your client and adjust the path:

| Client | Config location | Example |
|--------|----------------|---------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `examples/clients/claude/mcp.json` |
| Cursor | `.cursor/mcp.json` in your project | `examples/clients/cursor/mcp.json` |
| VS Code (Copilot) | `.vscode/mcp.json` in your project | `examples/clients/vscode/mcp.json` |

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

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SP_MCP_DATA_DIR` | `~/.local/share/super-productivity-mcp` | IPC directory shared between the Go binary and the plugin |
| `SP_MCP_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SP_MCP_TIMEOUT` | `30s` | Per-request timeout (e.g. `10s`, `60s`) |
| `SP_MCP_RETRIES` | `3` | Number of retries on transient bridge errors |

The plugin inside Super Productivity must be configured to use the **same** `SP_MCP_DATA_DIR`.

## Available tools

| MCP tool | What it does |
|----------|-------------|
| `create_task` | Create a new task |
| `get_tasks` | List tasks (optionally including done) |
| `get_task` | Get a specific task by ID |
| `update_task` | Update task fields |
| `complete_task` | Mark a task as done |
| `uncomplete_task` | Unmark a task as done |
| `archive_task` | Archive a task |
| `add_time_to_task` | Add tracked time (milliseconds) |
| `reorder_task` | Reorder tasks in a project/tag |
| `get_projects` | List all projects |
| `create_project` | Create a new project |
| `update_project` | Update a project |
| `get_tags` | List all tags |
| `create_tag` | Create a new tag |
| `update_tag` | Update a tag |
| `show_notification` | Show a notification in Super Productivity |
| `bridge_health` | Check that the plugin bridge is alive |
| `bridge_capabilities` | List supported bridge actions |

The full schema for each tool lives in [`internal/catalog/tools.json`](internal/catalog/tools.json).

## Development

### Run tests

```bash
# All checks (catalog drift + Go unit tests + JS tests + E2E)
make test

# Go unit tests only
go test ./...

# JS bridge tests only
node --test plugin/bridge/**/*.test.js

# E2E tests only
go test ./test/e2e -v
```

### Sync the tool catalog

`internal/catalog/tools.json` is the single source of truth for the tool surface. After editing it, propagate the copies:

```bash
make sync-catalogs
```

CI enforces that the copies never drift from the source (`make check-catalogs`).

### Architecture

- `cmd/sp-mcp/` — binary entrypoint
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
