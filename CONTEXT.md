# Super Productivity MCP Context

This repository is an integrated Super Productivity suite, not a set of
standalone apps. The supported release unit is one commit that produces several
installable artifacts.

## Domain Vocabulary

- **Integrated suite** — the repository-level product boundary. It ships the
  MCP server, quick-add app, Super Productivity plugin bridge, skill bundles,
  catalog, installer, and verification gates together.
- **Catalog** — the canonical contract in `internal/catalog/tools.json`. It
  names MCP tools/resources, plugin bridge actions, schemas, output schemas,
  protocol version, and stable resource payloads.
- **Plugin bridge** — the Super Productivity plugin runtime that consumes file
  IPC requests and executes catalog actions against `PluginAPI` or supported
  local adapters.
- **IPC lifecycle** — one request from inbox write through processing, outbox,
  deadletter, timeout, stall, cancellation, cleanup, and emitted lifecycle
  events.
- **MCP adapter** — the JSON-RPC/MCP layer that exposes catalog tools/resources
  and dispatches validated calls to the bridge.
- **Quick-add workflow** — the user-facing shortcut flow: collect a title,
  resolve prompt/popup assets and theme, create a task through the plugin
  bridge, then notify the user.
- **Skill bundle** — agent-facing instructions and diagnostics distributed with
  the suite. Skill bundles explain the contract; they do not define it.
- **Install profile** — a named installer shape such as suite, MCP-only,
  quick-add-only, plugin-only, or skill-only. Profiles are adapters over one
  install matrix.
- **Packaged plugin projection** — root `plugin.js`, the browser-safe packaged
  artifact that must remain behaviorally aligned with modular bridge source
  until bundling/generation replaces the transitional artifact.

## Contract Ownership

- `internal/catalog/tools.json` owns tool/resource/action/schema facts.
- `plugin/bridge/actions/` owns modular action implementations.
- `plugin.js` is a packaged artifact, not a second action source of truth.
  Its handler projection must stay mechanically checked against the modular
  bridge action registry until a generator replaces the checked-in artifact.
- `internal/domain.ProtocolVersion` and bridge-side protocol constants must stay
  aligned with the catalog protocol version.
- Installer docs, evals, skill docs, and generated docs should reference or
  derive from contract owners instead of repeating normative lists.
- The Go **Bridge** Interface is deliberately narrow. It is useful as the MCP
  adapter test surface and plugin IPC adapter seam, but it should not grow until
  there is a second production Adapter or more bridge behavior to hide.
- The quick-add workflow owns title resolution, prompt/popup asset resolution,
  bridge task creation, and user notifications behind `internal/quickadd`.
  `cmd/sp-quick-add` should stay a composition root for flags and runtime
  adapters.

## Architecture Direction

Prefer deep modules with small, stable interfaces and localized implementations:

- concentrate catalog/action compatibility in one seam;
- concentrate IPC lifecycle semantics in one module;
- keep MCP adapter transport, catalog resolution, dispatch, and reply shaping
  readable as separate internal modules behind the stable server interface;
- treat install profile entrypoints as adapters over a single matrix owner;
- split the task action implementation by domain behavior without changing
  catalog action names;
- deepen quick-add around the complete user workflow rather than thin wiring.
