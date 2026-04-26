# Super Productivity MCP Ops Checklist

1. Verify launch command path and permissions.
2. Run protocol smoke test for `initialize`.
3. Confirm `tools/list` includes all canonical tool names.
4. Execute `bridge_health` and one task operation.
5. If timeout occurs, inspect IPC directories (`inbox`, `outbox`).
6. Kill stale server processes and restart client host.
