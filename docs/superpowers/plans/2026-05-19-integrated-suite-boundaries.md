# Integrated Suite Boundaries Implementation Plan

> **For agentic workers:** Execute this plan task-by-task. Recommended path:
> dispatch a fresh subagent per task, review each result with `review-quality`,
> then continue. For complex multi-agent splits, use
> `parallel-feature-development`, `team-composition-patterns`, and
> `team-communication-protocols`. Steps use checkbox (`- [ ]`) syntax for
> tracking. Do not commit unless the user explicitly asks.

**Goal:** Keep this as one integrated Super Productivity suite while making the MCP server, quick-add app, plugin bridge, and agent skill explicit, separately installable artifacts.

**Architecture:** The repository remains the single source of truth for the shared Super Productivity integration contract: tool catalog, IPC envelope, plugin action semantics, runtime paths, and diagnostics. The suite ships multiple artifacts from one commit and adds per-artifact install profiles without duplicating the plugin or creating separate repositories. Documentation should explain that `sp-mcp` and `sp-quick-add` are separate clients of the same plugin bridge, not separate products with independent compatibility promises.

**Tech Stack:** Go 1.22, Bash install scripts, Node.js plugin packaging/tests, Markdown docs, Makefile orchestration.

---

## Requirements handoff

- `pipeline-type`: `full`
- `persistence-mode`: `openspec` / repo-file plan
- `change-name`: `integrated-suite-boundaries`

## Product boundaries

The suite has four artifacts, all released from the same commit:

| Artifact | Owns | Runtime dependency |
| --- | --- | --- |
| `sp-mcp` | MCP JSON-RPC stdio adapter for AI clients | Super Productivity plugin bridge |
| `sp-quick-add` | Desktop prompt/popup and direct task creation launcher | Super Productivity plugin bridge |
| Plugin zip | Super Productivity in-app bridge, catalog action handlers, file IPC watcher | Super Productivity |
| Agent skill bundle | Agent-facing diagnostics, protocol smoke checks, catalog snapshot | Installed suite artifacts/plugin contract |

Do not split repositories in this implementation. Do not duplicate `plugin.js` or `plugin/bridge/` into multiple product folders.

## File Map

- Create `docs/adr/0002-integrated-suite-repository.md`: record the decision to keep a single suite repo with multiple artifacts and one compatibility contract.
- Modify `docs/architecture/go-rewrite-layout.md`: rename the conceptual boundary from “Go rewrite package layout” to “Suite package and contract layout” while keeping current Go package names stable.
- Modify `Makefile`: add per-artifact install targets, add `test-install-profiles`, and keep `make install` as the full-suite install.
- Modify `scripts/install.sh`: add `BUILD_DIR`, `SKIP_MCP`, and `SKIP_QUICK_ADD` controls so Makefile install profiles can skip unrelated builds/assets safely and smoke tests can build outside the repo root.
- Modify `README.md`: describe the project as an integrated suite, add an artifact table, document install profiles/env vars, and clarify quick-add’s plugin dependency.
- Test with `bash -n scripts/install.sh`, `make test`, `make test-install-profiles`, and `make package-plugin`.

## Tasks

### Task 1: Capture the architecture decision

**Files:**
- Create: `docs/adr/0002-integrated-suite-repository.md`
- Modify: `docs/architecture/go-rewrite-layout.md`

- [ ] **Step 1: Create the ADR**

Create `docs/adr/0002-integrated-suite-repository.md` with this content:

```markdown
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
```

- [ ] **Step 2: Update architecture doc title and framing**

In `docs/architecture/go-rewrite-layout.md`, replace lines 1-11 with:

```markdown
# Suite package and contract layout

## Package boundaries

- `internal/domain`: shared suite contract types, including the plugin IPC protocol version, `Bridge` interface, request/response structs, and typed errors.
- `internal/catalog`: canonical tool catalog (SSOT for MCP name ↔ JS action ↔ schema), loaded from `internal/catalog/tools.json` and mirrored to `plugin/bridge/tool-catalog.json` and `skill/super-productivity-mcp/data/tool-catalog.json`.
- `internal/pluginipc`: file transport implementation for plugin bridge; owns the request lifecycle (inbox → outbox/deadletter, stall vs timeout distinction). Used by both `sp-mcp` and `sp-quick-add`.
- `internal/mcpadapter`: stdio adapter; dispatches `tools/call` directly to `Bridge.Call` using the catalog. No service layer.
- `internal/quickadd`: prompt/task/notification orchestration for `sp-quick-add`; depends on a task creator interface and uses the plugin IPC bridge in the CLI adapter.
- `internal/config`: env/path/timeout/poll-interval config shared by Go clients.
- `internal/logging`: logger construction.
- `internal/version`: build metadata + `MCPProtocolVersion` and `EnvelopeProtocolVersion` constants.
```

- [ ] **Step 3: Verify docs render as plain Markdown**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
for path in [Path('docs/adr/0002-integrated-suite-repository.md'), Path('docs/architecture/go-rewrite-layout.md')]:
    text = path.read_text(encoding='utf-8')
    assert text.startswith('# '), path
    assert 'fill this in' not in text.lower(), path
print('docs ok')
PY
```

Expected: exit 0 and `docs ok`.

### Task 2: Add Makefile install profiles

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update `.PHONY` targets**

Replace the existing `.PHONY` line with:

```make
.PHONY: test test-go test-js test-e2e test-evals generate-docs check-docs verify-release sync-catalogs check-catalogs install install-suite install-mcp install-quick-add install-plugin install-skill package-plugin test-install-profiles
```

- [ ] **Step 2: Replace the install target block**

Replace lines 7-11 with:

```make
verify-release: test test-install-profiles package-plugin

install: install-suite

install-suite:
	bash scripts/install.sh

install-mcp:
	SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1 bash scripts/install.sh

install-quick-add:
	SKIP_MCP=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1 bash scripts/install.sh

install-plugin:
	SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_DATA_DIR=1 bash scripts/install.sh

install-skill:
	SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_PLUGIN_ZIP=1 SKIP_DATA_DIR=1 bash scripts/install.sh

package-plugin:
	bash scripts/package-plugin.sh
```

Add this smoke target after `package-plugin`:

```make
test-install-profiles:
	@set -eu; \
	TMP_BASE="$$(if [ -d /tmp/opencode ]; then printf '%s' /tmp/opencode; else printf '%s' /tmp; fi)"; \
	TMP_ROOT="$$TMP_BASE/sp-mcp-install-profiles"; \
	rm -rf "$$TMP_ROOT"; \
	mkdir -p "$$TMP_ROOT"; \
	run_install() { \
		profile="$$1"; \
		shift; \
		prefix="$$TMP_ROOT/$$profile/prefix"; \
		build="$$TMP_ROOT/$$profile/build"; \
		data="$$TMP_ROOT/$$profile/data"; \
		env \
			-u BIN_DIR \
			-u SHARE_DIR \
			-u SKIP_BUILD \
			-u SKIP_MCP \
			-u SKIP_QUICK_ADD \
			-u SKIP_SKILL \
			-u SKIP_DATA_DIR \
			-u SKIP_PLUGIN_ZIP \
			PREFIX="$$prefix" \
			BIN_DIR="$$prefix/bin" \
			SHARE_DIR="$$prefix/share/super-productivity-mcp" \
			BUILD_DIR="$$build" \
			DATA_DIR="$$data" \
			"$$@" \
			bash scripts/install.sh; \
	}; \
	run_install full SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1; \
	test -x "$$TMP_ROOT/full/prefix/bin/sp-mcp"; \
	test -x "$$TMP_ROOT/full/prefix/bin/sp-quick-add"; \
	test -f "$$TMP_ROOT/full/prefix/share/super-productivity-mcp/quickadd-popup/popup.js"; \
	test -d "$$TMP_ROOT/full/data/inbox"; \
	run_install mcp SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1; \
	test -x "$$TMP_ROOT/mcp/prefix/bin/sp-mcp"; \
	test ! -e "$$TMP_ROOT/mcp/prefix/bin/sp-quick-add"; \
	test ! -e "$$TMP_ROOT/mcp/prefix/share/super-productivity-mcp/quickadd-popup/popup.js"; \
	test -d "$$TMP_ROOT/mcp/data/inbox"; \
	run_install quick-add SKIP_MCP=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1; \
	test ! -e "$$TMP_ROOT/quick-add/prefix/bin/sp-mcp"; \
	test -x "$$TMP_ROOT/quick-add/prefix/bin/sp-quick-add"; \
	test -f "$$TMP_ROOT/quick-add/prefix/share/super-productivity-mcp/quickadd-popup/popup.js"; \
	test -d "$$TMP_ROOT/quick-add/data/inbox"; \
	run_install skill SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_PLUGIN_ZIP=1 SKIP_DATA_DIR=1 SKILLS_DIR="$$TMP_ROOT/skill/skills"; \
	test -f "$$TMP_ROOT/skill/skills/super-productivity-mcp/SKILL.md"; \
	test ! -e "$$TMP_ROOT/skill/prefix/bin"; \
	run_install plugin SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_DATA_DIR=1; \
	set -- super-productivity-mcp-plugin-v*.zip; \
	test -f "$$1"; \
	test -f dist/plugin/super-productivity-mcp/manifest.json; \
	test ! -e "$$TMP_ROOT/plugin/prefix/bin"
```

- [ ] **Step 3: Verify Makefile target list parses**

Run:

```bash
make -n install-suite install-mcp install-quick-add install-plugin install-skill package-plugin
```

Expected: exit 0 and printed commands containing `scripts/install.sh` and `scripts/package-plugin.sh`.

### Task 3: Make installer profiles safe

**Files:**
- Modify: `scripts/install.sh`

- [ ] **Step 1: Update installer usage comments**

Replace lines 6-20 with:

```bash
# Usage:
#   scripts/install.sh                    # full suite: MCP, quick-add, skill, plugin zip
#   PREFIX=/opt/sp scripts/install.sh     # override install prefix
#   BUILD_DIR=/tmp/build scripts/install.sh  # build binaries outside the repo root
#   SKIP_MCP=1 scripts/install.sh         # skip MCP binary build/install
#   SKIP_QUICK_ADD=1 scripts/install.sh   # skip quick-add binary and popup assets
#   SKIP_SKILL=1 scripts/install.sh       # skip skill install
#   SKIP_PLUGIN_ZIP=1 scripts/install.sh  # skip plugin zip packaging
#   SKIP_BUILD=1 scripts/install.sh       # use existing requested binaries
#
# Honored env vars:
#   PREFIX          (default: $HOME/.local)
#   BIN_DIR         (default: $PREFIX/bin)
#   SHARE_DIR       (default: $PREFIX/share/super-productivity-mcp)
#   BUILD_DIR       (default: $ROOT_DIR)
#   DATA_DIR        (default: $XDG_DATA_HOME/super-productivity-mcp or
#                    $HOME/.local/share/super-productivity-mcp)
#   SKILLS_DIR      (default: first existing of ~/.agents/skills,
#                    ~/.claude/skills, then ~/.agents/skills as fallback)
#   SKIP_BUILD, SKIP_MCP, SKIP_QUICK_ADD, SKIP_SKILL, SKIP_DATA_DIR,
#   SKIP_PLUGIN_ZIP
```

- [ ] **Step 2: Replace the build section**

Replace lines 53-65 with:

```bash
# 1. Build the requested binaries.
if [[ -z "${SKIP_BUILD:-}" ]]; then
  if [[ -z "${SKIP_MCP:-}" ]]; then
    command -v go >/dev/null 2>&1 || fail "go is required to build sp-mcp"
    log "Building sp-mcp"
    go build -o "$ROOT_DIR/sp-mcp" ./cmd/sp-mcp
  fi

  if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
    command -v go >/dev/null 2>&1 || fail "go is required to build sp-quick-add"
    log "Building sp-quick-add"
    go build -o "$ROOT_DIR/sp-quick-add" ./cmd/sp-quick-add
  fi
else
  if [[ -z "${SKIP_MCP:-}" ]]; then
    [[ -x "$ROOT_DIR/sp-mcp" ]] || fail "SKIP_BUILD set but $ROOT_DIR/sp-mcp is missing"
  fi
  if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
    [[ -x "$ROOT_DIR/sp-quick-add" ]] || fail "SKIP_BUILD set but $ROOT_DIR/sp-quick-add is missing"
  fi
  log "Skipping build (using existing requested binaries)"
fi
```

- [ ] **Step 3: Replace the binary and popup install section**

Replace lines 67-78 with:

```bash
# 2. Install the requested binaries and assets.
mkdir -p "$BIN_DIR"

if [[ -z "${SKIP_MCP:-}" ]]; then
  log "Installing binary to $BIN_DIR/sp-mcp"
  install -m 0755 "$ROOT_DIR/sp-mcp" "$BIN_DIR/sp-mcp"
fi

if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
  log "Installing binary to $BIN_DIR/sp-quick-add"
  install -m 0755 "$ROOT_DIR/sp-quick-add" "$BIN_DIR/sp-quick-add"

  log "Installing quick-add popup assets to $SHARE_DIR/quickadd-popup"
  mkdir -p "$SHARE_DIR/quickadd-popup"
  install -m 0755 "$ROOT_DIR/quickadd-popup/popup.js" "$SHARE_DIR/quickadd-popup/popup.js"
  install -m 0644 "$ROOT_DIR/quickadd-popup/style.css" "$SHARE_DIR/quickadd-popup/style.css"
fi
```

- [ ] **Step 4: Add summary variables before the final `cat`**

Insert this block immediately before line 116 (`GREEN=...`):

```bash
MCP_SUMMARY="<skipped>"
QUICK_ADD_SUMMARY="<skipped>"
POPUP_SUMMARY="<skipped>"
SKILL_SUMMARY="${SKILL_DEST:-<skipped>}"

if [[ -z "${SKIP_MCP:-}" ]]; then
  MCP_SUMMARY="$BIN_DIR/sp-mcp"
fi
if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
  QUICK_ADD_SUMMARY="$BIN_DIR/sp-quick-add"
  POPUP_SUMMARY="$SHARE_DIR/quickadd-popup"
fi
```

- [ ] **Step 5: Update final summary paths**

In the final heredoc, replace lines 121-126 with:

```bash
  mcp:       $MCP_SUMMARY
  quick add: $QUICK_ADD_SUMMARY
  popup:     $POPUP_SUMMARY
  data dir:  $DATA_DIR
  skill:     $SKILL_SUMMARY
  plugin:    $PLUGIN_ZIP
```

- [ ] **Step 6: Update the verify block**

Replace lines 151-154 with:

```bash
${BOLD}Verify${RESET}
  MCP smoke:       ${MCP_SUMMARY} --version 2>/dev/null || echo "(no --version flag yet; smoke-test via your MCP client)"
  Quick-add smoke: ${QUICK_ADD_SUMMARY} --dry-run --title "Smoke quick add @today"
```

- [ ] **Step 7: Update quick-add instructions in the heredoc**

Replace lines 155-157 with:

```bash
${BOLD}Omarchy / Hyprland quick add${RESET}
  Quick-add requires the Super Productivity plugin bridge to be installed and enabled.
  Add this to ~/.config/hypr/bindings.conf:
    bindd = SUPER SHIFT, T, Super Productivity quick add, exec, uwsm-app -- $BIN_DIR/sp-quick-add
```

- [ ] **Step 8: Syntax-check installer**

Run:

```bash
bash -n scripts/install.sh
```

Expected: exit 0.

### Task 4: Document the integrated suite and install profiles

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the opening description**

Replace lines 3-5 with:

```markdown
An integrated Super Productivity automation suite with a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server, a desktop quick-add launcher, a Super Productivity plugin bridge, and an agent skill bundle.

With this suite you can ask your AI assistant to create tasks, list projects, add tracked time, and more. You can also use `sp-quick-add` to add tasks from your desktop without opening an AI client.
```

- [ ] **Step 2: Replace the “How it works” diagram**

Replace lines 9-22 with:

````markdown
```
AI client (Claude / Cursor / VS Code)
    │  MCP JSON-RPC over stdio
    ▼
sp-mcp
    │
    │  file IPC  (inbox / outbox / deadletter)
    ▼
Super Productivity plugin bridge
    ▲
    │  file IPC task.create
    │
sp-quick-add  (desktop prompt / popup)
    │
    ▼
Super Productivity PluginAPI
    │
    ▼
Super Productivity
```

`sp-mcp` and `sp-quick-add` are separate clients of the same plugin bridge. The plugin bridge runs inside Super Productivity and is required for either client to create or read tasks.
````

- [ ] **Step 3: Add artifact table after the diagram paragraph**

Insert after the new `sp-mcp` / `sp-quick-add` paragraph:

```markdown
## Suite artifacts

| Artifact | What it does | Install target |
| --- | --- | --- |
| `sp-mcp` | MCP server for AI clients | `make install-mcp` |
| `sp-quick-add` + `quickadd-popup/` | Desktop quick-add launcher and popup assets | `make install-quick-add` |
| Super Productivity plugin zip | In-app bridge that executes catalog actions | `make install-plugin` or `make package-plugin` |
| `skill/super-productivity-mcp` | Agent skill bundle and diagnostics | `make install-skill` |

`make install` installs the full suite. The per-artifact targets are convenience profiles; the supported release unit is still the suite built from one commit.
```

- [ ] **Step 4: Update quick install text**

Replace lines 34-44 with:

````markdown
### Quick install: full suite

One-shot installer — builds the MCP and quick-add binaries, sets up the IPC data directory, installs the skill, packages the plugin zip, and prints the MCP client config:

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
make install
```

Install only one artifact profile when you do not want the full suite:

```bash
make install-mcp        # MCP binary + IPC data directory
make install-quick-add  # quick-add binary + popup assets + IPC data directory
make install-plugin     # plugin zip only
make install-skill      # agent skill bundle only
```

Honored env vars: `PREFIX`, `BIN_DIR`, `SHARE_DIR`, `BUILD_DIR`, `DATA_DIR`, `SKILLS_DIR`, `SKIP_BUILD`, `SKIP_MCP`, `SKIP_QUICK_ADD`, `SKIP_SKILL`, `SKIP_DATA_DIR`, `SKIP_PLUGIN_ZIP`. Defaults install to `~/.local/bin` and `~/.local/share/super-productivity-mcp`.

If you override `SHARE_DIR` outside the default prefix layout, `sp-quick-add --prompt popup` will only find its popup assets when you also set `SP_QUICK_ADD_POPUP_DIR` or pass `--popup-dir`.
````

- [ ] **Step 5: Clarify quick-add runtime dependency**

Replace line 132 with:

```markdown
`sp-quick-add` opens a prompt and creates a Super Productivity task through the same plugin IPC bridge as the MCP server. It does not require `sp-mcp`, but it does require the Super Productivity plugin bridge to be installed and enabled. Walker remains the default prompt. A themeable GTK/Wayland popup is available with `--prompt popup`. Both support the same task title short syntax handled by `create_task` (`#tag`, `+project`, `@due`, estimates like `30m`).
```

- [ ] **Step 6: Update architecture bullet list**

Replace lines 313-324 with:

```markdown
### Architecture

- `cmd/sp-mcp/` — MCP binary entrypoint for AI clients
- `cmd/sp-quick-add/` — Omarchy/Hyprland quick-add entrypoint
- `internal/quickadd/` — prompt/task/notification orchestration for quick add
- `internal/catalog/` — tool catalog (SSOT); loaded at startup and mirrored to plugin/skill copies
- `internal/mcpadapter/` — MCP JSON-RPC 2.0 stdio adapter
- `internal/pluginipc/` — shared file-based IPC transport (inbox → processing → outbox / deadletter)
- `internal/config/` — environment/config loading shared by Go clients
- `internal/domain/` — shared suite contract types and interfaces
- `plugin/bridge/` — JavaScript bridge that runs inside Super Productivity
- `skill/super-productivity-mcp/` — agent skill bundle and diagnostics synchronized with the suite catalog
```

- [ ] **Step 7: Run catalog-derived docs check**

Run:

```bash
make check-docs
```

Expected: exit 0. This confirms README edits did not accidentally replace generated `docs/tools.md` content.

### Task 5: Verify install profile behavior

**Files:**
- Test only: `Makefile`, `scripts/install.sh`, generated temp install tree under `/tmp`

- [ ] **Step 1: Run script syntax and unit tests**

Run:

```bash
bash -n scripts/install.sh
make test
```

Expected: both commands exit 0.

- [ ] **Step 2: Smoke the full-suite install into a temp prefix**

Run:

```bash
rm -rf /tmp/sp-suite-install-full
PREFIX=/tmp/sp-suite-install-full SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1 bash scripts/install.sh
test -x /tmp/sp-suite-install-full/bin/sp-mcp
test -x /tmp/sp-suite-install-full/bin/sp-quick-add
test -f /tmp/sp-suite-install-full/share/super-productivity-mcp/quickadd-popup/popup.js
```

Expected: all commands exit 0.

- [ ] **Step 3: Smoke the MCP-only profile**

Run:

```bash
rm -rf /tmp/sp-suite-install-mcp
PREFIX=/tmp/sp-suite-install-mcp make install-mcp
test -x /tmp/sp-suite-install-mcp/bin/sp-mcp
test ! -e /tmp/sp-suite-install-mcp/bin/sp-quick-add
test ! -e /tmp/sp-suite-install-mcp/share/super-productivity-mcp/quickadd-popup/popup.js
```

Expected: all commands exit 0.

- [ ] **Step 4: Smoke the quick-add-only profile**

Run:

```bash
rm -rf /tmp/sp-suite-install-quick-add
PREFIX=/tmp/sp-suite-install-quick-add make install-quick-add
test ! -e /tmp/sp-suite-install-quick-add/bin/sp-mcp
test -x /tmp/sp-suite-install-quick-add/bin/sp-quick-add
test -f /tmp/sp-suite-install-quick-add/share/super-productivity-mcp/quickadd-popup/popup.js
```

Expected: all commands exit 0.

- [ ] **Step 5: Smoke plugin packaging**

Run:

```bash
make package-plugin
set -- super-productivity-mcp-plugin-v*.zip
test -f "$1"
test -f dist/plugin/super-productivity-mcp/manifest.json
test -f dist/plugin/super-productivity-mcp/plugin.js
```

Expected: all commands exit 0.

- [ ] **Step 6: Smoke skill-only profile without touching real skill directories**

Run:

```bash
rm -rf /tmp/sp-suite-install-skill /tmp/sp-suite-skills
SKILLS_DIR=/tmp/sp-suite-skills PREFIX=/tmp/sp-suite-install-skill make install-skill
test -f /tmp/sp-suite-skills/super-productivity-mcp/SKILL.md
test -f /tmp/sp-suite-skills/super-productivity-mcp/data/tool-catalog.json
test ! -e /tmp/sp-suite-install-skill/bin/sp-mcp
test ! -e /tmp/sp-suite-install-skill/bin/sp-quick-add
```

Expected: all commands exit 0.

- [ ] **Step 7: Check git diff for unintended generated artifacts**

Run:

```bash
git status --short
```

Expected: only intentional source/doc changes are present. Generated zip or `dist/` changes should not be included unless the user explicitly wants release artifacts tracked.

## Self-review checklist

- Spec coverage: the plan rejects repo splitting, preserves one suite repo, makes all four artifacts explicit, adds per-artifact install profiles, and documents quick-add’s plugin dependency.
- Placeholder scan: this plan contains no unresolved implementation placeholders.
- Type/target consistency: Makefile targets call installer controls that Task 3 adds (`SKIP_MCP`, `SKIP_QUICK_ADD`, `SKIP_SKILL`, `SKIP_PLUGIN_ZIP`, `SKIP_DATA_DIR`).
- Risk control: no package renames, no repository splits, no plugin duplication, and no commits without explicit user request.
