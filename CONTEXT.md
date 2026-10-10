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
- **Quick-add workflow** — the user-facing shortcut flow: collect a title through
  Walker or a command argument, create a task through the plugin
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
- The quick-add workflow owns title resolution, Walker prompting,
  bridge task creation, and user notifications behind `internal/quickadd`.
  `cmd/sp-quick-add` should stay a composition root for flags and runtime
  adapters.

## Agent Scheduling Workflow Baseline

When this suite is used for broad Super Productivity task overhaul, preserve the
current operating-system rules unless the user overrides them:

- Use title form `[Category] Task: detail`. Do not encode frequency in the title
  when recurrence already carries it.
- Keep project/backlog tasks outside core framework projects unscheduled unless
  they are explicitly tagged `Active` or the user asks to schedule that project.
- General work blocks are allowed and useful. Specific tasks may be scheduled on
  top of them when they are the chosen concrete work for that block.
- Spread weekly/monthly/quarterly reviews across the week. Do not put everything
  on Monday or the first Monday unless the task truly benefits from early-week
  placement.
- Maintain real weekend anchors for reset, chores, low-pressure creative capture,
  relationships, review, and shutdown. Weekend schedules should be lighter than
  weekday schedules.
- Add useful notes to active tasks. Each note should name the done state, scope,
  or next action so the task can be executed later without reconstructing intent.

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
