# Super Productivity MCP Diagnostic Playbook

## Contents

- [SPM1: Launch mismatch](#spm1-launch-mismatch)
- [SPM2: Handshake stall](#spm2-handshake-stall)
- [SPM3: Surface drift](#spm3-surface-drift)
- [SPM4: Bridge timeout](#spm4-bridge-timeout)
- [SPM5: Client drift](#spm5-client-drift)
- [SPM6: Catalog drift](#spm6-catalog-drift)
- [SPM7: Recurrence failure](#spm7-recurrence-failure)

## SPM1: Launch mismatch

Evidence includes immediate exit, an invalid command, or an unexpected binary.

- Resolve the configured command and all wrapper layers.
- Check file type, executable permissions, and version.
- Inspect running processes for an older command before restarting anything.
- Prefer one stable launcher with explicit environment defaults.

## SPM2: Handshake stall

Evidence includes repeated waiting for `initialize`.

- Run `scripts/protocol_smoke.ts` against the exact executable.
- Require JSON-RPC 2.0 responses for `initialize`.
- Keep logs on stderr and protocol messages on stdout.
- If terminal smoke succeeds, inspect stale processes and client startup state.

## SPM3: Surface drift

Evidence includes missing/unknown tools or unreadable `sp://` resources.

- Compare `tools/list` and `resources/list` with the catalog.
- Check `mcpName`, `action`, schema fields, and JS handler keys.
- Change `internal/catalog/tools.json`, then run `make sync-catalogs`.
- Avoid hard-coded tool counts; use `scripts/catalog_summary.ts`.

## SPM4: Bridge timeout

Evidence includes calls that time out while requests accumulate.

- Confirm server and plugin use the same `SP_MCP_DATA_DIR`.
- Inspect movement through `inbox`, `processing`, `outbox`, and `deadletter`.
- Verify request and response IDs match.
- Confirm the plugin bridge loop is active before changing timeout values.

## SPM5: Client drift

Evidence is success in one client and failure in another.

- Compare server ID, executable, arguments, environment, and version.
- Remove duplicate entries only after resolving the intended canonical entry.
- Pin versions when clients otherwise resolve different runtime builds.
- Re-test every affected client after normalization.

## SPM6: Catalog drift

Evidence includes failed catalog checks or handler/catalog mismatch errors.

- Run `make check-catalogs`.
- Update the Go-side source of truth rather than generated mirrors.
- Ensure required schema fields match what handlers actually read.
- Run catalog, Go, JavaScript, and relevant end-to-end tests.

## SPM7: Recurrence failure

Evidence includes missing recurrence tools, unsupported actions, or unexpected
confirmation dialogs.

- Require `set_task_recurrence`, `update_task_recurrence`, and
  `delete_task_recurrence` in `tools/list`.
- Require the matching bridge capabilities.
- Use recurrence actions only with the patched Super Productivity build.
- For noninteractive updates, omit
  `isAskToUpdateAllTaskInstances` or pass `false`; `true` intentionally opens a
  confirmation dialog.
- Verify `repeatCfgId`, `dueDay`, and `plannedAt` from a fresh task read.
