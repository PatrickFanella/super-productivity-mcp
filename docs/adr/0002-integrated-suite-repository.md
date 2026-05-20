# ADR 0002: Integrated suite repository

## Status

Accepted

## Context

The repository now ships multiple user-facing artifacts:

- `sp-mcp`, the MCP server used by AI clients.
- `sp-quick-add`, the desktop quick-add launcher.
- The Super Productivity plugin zip, which runs inside Super Productivity and owns bridge actions.
- The agent skill bundle, which documents and validates the suite for agent users.

These artifacts look like separate apps, but they share one compatibility contract:

- `internal/catalog/tools.json` is the canonical action/tool catalog.
- `plugin/bridge/tool-catalog.json` and `skill/super-productivity-mcp/data/tool-catalog.json` are synchronized copies.
- `internal/domain.ProtocolVersion` and `plugin/bridge/ipc.js` must agree on the IPC envelope version.
- `SP_MCP_DATA_DIR` and its `inbox`, `processing`, `outbox`, `events`, and `deadletter` children are shared by the Go clients and plugin bridge.
- The plugin bridge is the runtime authority that executes both MCP requests and quick-add `task.create` requests.

Splitting the artifacts into separate repositories now would make catalog, protocol, plugin action, installer, and diagnostic drift more likely.

## Decision

Keep one repository and treat it as an integrated Super Productivity suite with multiple installable artifacts.

Ship these artifacts from the same commit:

1. `sp-mcp`
2. `sp-quick-add` plus `quickadd-popup/` assets
3. Super Productivity plugin zip
4. `skill/super-productivity-mcp` bundle

Add per-artifact install targets for users who only want part of the suite, but do not create separate repositories and do not duplicate the plugin bridge into multiple product folders.

## Compatibility policy

- A released suite version is the supported compatibility unit.
- Mixed artifact versions are best-effort unless the IPC protocol version and catalog actions match.
- IPC envelope shape changes require a protocol version review and a documented compatibility note in `docs/protocol/plugin-ipc-v2.md`.
- Catalog action additions are minor-compatible when old actions keep their semantics.
- Catalog action removals, renames, or payload contract changes are breaking changes.
- Plugin zip, MCP binary, quick-add binary, and skill bundle must pass repo-local tests before release.

## Consequences

- `make install` remains the full-suite install path.
- Additional install profiles may install only MCP, quick-add, plugin packaging output, or the skill bundle.
- Quick-add can be installed separately from MCP, but it still requires the plugin bridge at runtime to create tasks in Super Productivity.
- The agent skill remains in-tree so diagnostics and catalog examples stay aligned with shipped artifacts.
- Future repository splits should start by extracting a stable, versioned contract package rather than by duplicating product code.

## Rejected alternatives

- Split all four artifacts into separate repositories now: rejected because most feature changes would become multi-repo catalog/protocol/plugin coordination.
- Vendor or duplicate the plugin bridge into MCP and quick-add repos: rejected because users could install mismatched bridge copies.
- Split quick-add immediately: rejected because it is independently useful but still depends on the same plugin action contract.
- Split the skill immediately: rejected because its diagnostic value depends on staying synchronized with the suite contract.

## Test gates

- `make check-catalogs`
- `make test`
- `make test-install-profiles`
- `make package-plugin`
- Temp-prefix smoke installs for full suite, MCP-only, quick-add-only, plugin-only, and skill-only profiles before release-facing installer changes.
