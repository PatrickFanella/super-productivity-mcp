# Super Productivity MCP Operations Checklist

Use this read-only sequence before editing runtime or client configuration.

1. Resolve the exact configured command, environment, client server ID, and
   `SP_MCP_DATA_DIR`.
2. Run:

   ```bash
   ./validate.sh --command /path/to/sp-mcp --data-dir /path/to/ipc
   ```

3. Confirm `initialize`, `tools/list`, and `resources/list` match
   `data/tool-catalog.json`.
4. Confirm the IPC directories exist and are readable: `inbox`, `processing`,
   `outbox`, `events`, and `deadletter`.
5. If the application is running, call `bridge_health`, `check_connection`,
   `debug_directories`, and one nonmutating task/resource read.
6. For timeouts, inspect queue movement and request/response ID correlation
   without writing probe files into live queues.
7. For client-specific failures, compare command, environment, server ID,
   version, and duplicate entries across clients.
8. Before stopping any process, inspect PID, command, parent, and start time.
   Ask before stopping anything not proven to be the target MCP server.
9. Re-run the validator and the original client operation after the smallest
   targeted fix.

Report every skipped or unavailable check as unverified.
