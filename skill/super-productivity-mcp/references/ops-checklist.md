# Super Productivity MCP Ops Checklist

1. Verify launch command path and permissions.
2. Run protocol smoke test for `initialize`.
3. Confirm `tools/list` includes all tool names declared in `data/tool-catalog.json`.
4. Confirm `resources/list` includes all resource URIs declared in `data/tool-catalog.json`.
5. Execute `bridge_health`, `check_connection`, `debug_directories`, and one task operation.
6. If timeout occurs, inspect IPC directories (`inbox`, `processing`, `outbox`, `deadletter`).
7. Kill stale server processes and restart client host.
