# ADR 0001: Plugin bridge source of truth

## Status

Accepted

## Context

The repository currently has two JavaScript plugin bridge surfaces:

- `plugin/bridge/actions/*.js`: modular action handlers used by bridge-focused tests.
- `plugin.js`: root packaged browser plugin entrypoint uploaded to Super Productivity.

Recent MCP tool work had to update both surfaces for every new task action. This creates drift risk: the catalog can expose an action that exists in the modular bridge but is missing from the packaged root plugin, or the two implementations can diverge in safety semantics such as dry-run defaults.

The catalog remains the tool surface source of truth: `internal/catalog/tools.json` is synced to `plugin/bridge/tool-catalog.json` and `skill/super-productivity-mcp/data/tool-catalog.json` by `make sync-catalogs`.

## Decision

Keep `internal/catalog/tools.json` as the public MCP tool surface source of truth.

Make the modular bridge handlers under `plugin/bridge/actions/` the implementation source of truth for action behavior.

Treat root `plugin.js` as a packaged artifact that must stay behaviorally equivalent until a build step can generate or bundle it from the modular bridge.

## Consequences

- New actions MUST be added to `plugin/bridge/actions/` first, with tests in `plugin/bridge/actions/*.test.js`.
- Root `plugin.js` MUST be updated for parity until generation exists.
- `plugin/plugin.test.js` and `bridge.capabilities` tests MUST catch catalog/action drift.
- Broad behavior changes need both modular tests and root plugin smoke coverage when possible.

## Migration plan

1. Keep current parity workflow: edit modular handlers, mirror root `plugin.js`, run `make test`.
2. Add a packaging-time parity check that compares root supported actions with the catalog.
3. Prototype a bundling step that emits root `plugin.js` from modular bridge code into `dist/plugin/super-productivity-mcp/plugin.js`.
4. Once bundling is stable, stop hand-editing root `plugin.js` for action behavior.
5. Keep root `plugin.js` in git only if Super Productivity upload workflows need a checked-in single-file plugin; otherwise generate it during `make package-plugin`.

## Rejected alternatives

- Root `plugin.js` as source of truth: rejected because the file is large and harder to test in focused units.
- Catalog as implementation source of truth: rejected because schemas describe tools but cannot encode behavior safely.
- Immediate bundling refactor: rejected for this wave because it touches packaging and runtime loading; documentation first reduces risk.

## Test gates

- `make sync-catalogs`
- `make test`
- `make package-plugin` before release-facing packaging changes
