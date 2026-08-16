---
name: super-productivity-mcp
description: Diagnose and repair Super Productivity MCP launch, initialization, catalog, resource, client-configuration, IPC bridge, and recurrence-tool failures. Use when Super Productivity tools are unavailable, hang, time out, differ across clients, expose the wrong tool/resource surface, or fail before task planning can proceed; use super-productivity-planning for healthy-server task changes.
---

# Super Productivity MCP Diagnostics

Treat failures as a pipeline:

`launch → initialize → tools/resources → bridge round-trip → client parity`

## Boundaries

- Own MCP runtime health, protocol behavior, catalogs, IPC, plugin bridge, and
  client configuration.
- Route task cleanup, Inbox triage, estimates, tags, dates, and scheduling to
  `super-productivity-planning` after the MCP is healthy.
- Require a configured Super Productivity MCP for live task work. Do not use
  shell or UI fallbacks to mutate personal task data.
- Diagnose before changing code or configuration. Apply the smallest fix in
  the failing layer.

## Failure Router

| State | Evidence | First check |
|---|---|---|
| SPM1 Launch mismatch | exits, wrong binary, bad path | resolve exact command and executable |
| SPM2 Handshake stall | `initialize` never returns | run protocol smoke against exact command |
| SPM3 Surface drift | missing or unknown tools/resources | compare lists with the canonical catalog |
| SPM4 Bridge timeout | calls time out or queue files accumulate | verify shared IPC path and response IDs |
| SPM5 Client drift | works in only one client | compare command, environment, and server IDs |
| SPM6 Catalog drift | catalog sync or handler parity fails | inspect SSOT and run catalog checks |
| SPM7 Recurrence failure | recurrence tools fail or prompt | verify patched app capability and flags |

Read `references/diagnostic-playbook.md` for state-specific checks and fixes.

## Workflow

1. Capture the exact failing client, command, error, and first failing method.
2. Run the read-only checks in `references/ops-checklist.md`.
3. Classify the first failing pipeline state.
4. Inspect only that layer and collect evidence before editing.
5. Apply one minimal fix.
6. Re-run terminal smoke tests and the affected client.
7. Report the failed layer, evidence, change, and verification.

Use parallel subagents only for independent read-heavy work such as comparing
multiple client configs or reducing separate log sets. Keep fixes centralized.

## Bundled Tools

Resolve paths relative to this skill directory.

```bash
./validate.sh
```

The validator defaults to `sp-mcp` from `PATH` and
`$SP_MCP_DATA_DIR` or `~/.local/share/super-productivity-mcp`. Override them:

```bash
./validate.sh --command /path/to/sp-mcp --data-dir /path/to/ipc
```

Inspect the catalog without loading the full JSON into context:

```bash
deno run --allow-read scripts/catalog_summary.ts data/tool-catalog.json
```

The validation path is nonmutating. A live bridge call is intentionally
separate because it requires a running Super Productivity application.

## Catalog Contract

- Treat `internal/catalog/tools.json` in the suite repository as the source of
  truth.
- Treat `plugin/bridge/tool-catalog.json` and this skill's
  `data/tool-catalog.json` as generated mirrors.
- Edit the source of truth, run `make sync-catalogs`, then run
  `make check-catalogs`.
- Match catalog `mcpName`, `action`, schema fields, and bridge handler keys.

## Safety

- Treat Super Productivity as live personal data.
- Keep diagnostic probes read-only unless the user explicitly requests repair.
- Before killing or restarting a process, inspect its PID, command, parent, and
  start time. Ask before stopping anything not proven to be the target server.
- Do not add duplicate MCP server IDs to fix discovery.
- Keep protocol logs on stderr; stdout must remain protocol-clean.
- Store task-specific artifacts outside the shared skill directory unless the
  user explicitly asks to update the skill.

## Completion Contract

Do not claim recovery until:

- the configured command launches;
- `initialize` succeeds;
- `tools/list` and `resources/list` match the catalog;
- the affected client reconnects;
- a nonmutating bridge health/read call succeeds when the live app is required.

State any verification that could not be completed.
