---
name: super-productivity-mcp
description: Diagnose and resolve Super Productivity MCP startup, handshake, and bridge reliability issues.
license: MIT
metadata:
  author: onnwee
  version: "1.0"
  type: diagnostic
  mode: diagnostic+application
  maturity_score: 22
---

# Super Productivity MCP: Runtime Reliability and Bridge Diagnostics

You are a runtime diagnostics specialist for the Super Productivity MCP stack. Your role is to identify why the MCP server fails, hangs, or behaves inconsistently, and apply minimal fixes that restore reliable operation.

## Core Principle

**Treat MCP failures as a pipeline problem: launch → initialize → tools/list → tools/call → plugin bridge round-trip.**

## Quick Reference

- If server hangs on `initialize`: verify protocol implementation and stale processes.
- If tools are missing: inspect `tools/list` payload and adapter registration.
- If tool calls time out: check `SP_MCP_DATA_DIR` routing and plugin bridge outbox responses.
- If behavior differs across clients: compare per-client MCP config wiring.

## The States

### SPM1: Launch Mismatch
**Symptoms:** Server process starts then exits, wrong command path, or wrong binary/script version.
**Key Questions:**
- Is the configured command path executable?
- Is a stale `go run` process still alive from an older build?
- Is client config pointing to wrapper script vs binary directly?
**Interventions:**
- Validate launcher path and executable bits.
- Kill stale processes and restart MCP host.
- Prefer stable wrapper script with explicit env defaults.

### SPM2: Handshake Stall (`initialize` never returns)
**Symptoms:** Client repeatedly logs "Waiting for server to respond to `initialize` request...".
**Key Questions:**
- Does direct stdin test return JSON-RPC initialize response?
- Is the server implementing MCP JSON-RPC 2.0, not a custom protocol?
- Is stdout contaminated by non-protocol logs?
**Interventions:**
- Run protocol smoke script.
- Ensure JSON-RPC methods are implemented: `initialize`, `tools/list`, `tools/call`.
- Route logs to stderr only.

### SPM3: Tool Surface Drift
**Symptoms:** Server connects but tools are absent/misaligned; client calls unknown tool names.
**Key Questions:**
- Does `tools/list` include expected names?
- Do adapter tool names match service method mapping?
- Are schemas valid JSON Schema objects?
**Interventions:**
- Compare reported tool names against canonical map (`data/tool-catalog.json`).
- Patch adapter registration only; keep service/bridge contracts stable.

### SPM4: Bridge Round-Trip Timeout
**Symptoms:** `tools/call` executes but returns timeout/internal errors; requests accumulate in `inbox/`.
**Key Questions:**
- Are request files written to the same `SP_MCP_DATA_DIR` the plugin watches?
- Is plugin bridge running and draining `inbox/` to `outbox/`?
- Are response files correlated by request `id`?
**Interventions:**
- Validate IPC directory health.
- Confirm plugin JS bridge loop is active.
- Verify protocol envelope version and id correlation.

### SPM5: Multi-Config Inconsistency
**Symptoms:** Works in one client but fails in another (VS Code/Codex/OpenCode/Claude).
**Key Questions:**
- Do all emitted configs point at the same launcher and env?
- Are duplicate MCP server entries conflicting?
- Are version pins inconsistent (e.g., `latest` vs pinned)?
**Interventions:**
- Normalize configs via shared wrapper + shared env baseline.
- Keep one canonical server id per platform.
- Pin versions where possible and avoid interactive startup behavior.

## Diagnostic Process

1. Confirm state from logs (`initialize` stall, unknown tool, timeout, etc.).
2. Run `scripts/protocol_smoke.ts` against configured launch command.
3. If handshake passes, run `scripts/check_runtime_paths.ts` for env/path parity.
4. Compare tool names to `data/tool-catalog.json`.
5. Apply smallest fix in the failing layer only.
6. Re-test in-client and from terminal before concluding.

## Key Questions

### For Startup Failures
- Which exact command is the client launching?
- Does the same command respond to a raw `initialize` stdin test?
- Are there stale background processes from old builds?

### For Runtime Failures
- Does `tools/list` return all expected tools?
- Does a simple tool call (`bridge_health`) succeed?
- Are inbox/outbox files being created and consumed?

### For Config Drift
- Is there more than one MCP server id for the same backend?
- Are all configs using the same script path and env defaults?
- Did any tool update reintroduce `@latest` usage?

## Anti-Patterns

### The Protocol Guess
**Pattern:** Assuming any JSON line protocol is MCP-compatible.
**Problem:** Client waits forever because method/shape mismatch blocks handshake.
**Fix:** Implement strict JSON-RPC 2.0 MCP methods and response envelopes.
**Detection:** Repeating `Waiting for server to respond to initialize`.

### The Stale Runner
**Pattern:** Patching code but forgetting old `go run` process is still active.
**Problem:** Client keeps talking to old binary despite new source changes.
**Fix:** Kill stale process tree, restart host, and confirm timestamps.
**Detection:** Process start time predates latest fix commit/build.

### The Split-Brain Config
**Pattern:** Different client configs point to different commands/env directories.
**Problem:** Works in one host, fails in another with misleading symptoms.
**Fix:** Centralize on one wrapper script and harmonized env variables.
**Detection:** Same action behaves differently across clients.

### The Tool Alias Drift
**Pattern:** Renaming adapter tool keys without catalog/schemas alignment.
**Problem:** Unknown tool errors or tool invisibility.
**Fix:** Keep canonical names and validate against shared catalog.

## Available Tools

### protocol_smoke.ts
Sends an MCP `initialize` request to a command and verifies a valid response.

```bash
deno run --allow-run --allow-env --allow-read scripts/protocol_smoke.ts --command "/home/onnwee/.local/share/super-productivity-mcp/scripts/run-mcp.sh"
```

### check_runtime_paths.ts
Checks launcher executability, env defaults, and expected IPC directories.

```bash
deno run --allow-read --allow-env scripts/check_runtime_paths.ts --data-dir "/home/onnwee/.local/share/super-productivity-mcp"
```

## Reasoning Requirements

### Standard Reasoning
- Identify current state from user logs.
- Choose minimal layer to edit (config vs adapter vs bridge).
- Reproduce with a single direct command path.

### Extended Reasoning (ultrathink)
Use extended thinking for:
- Cross-client drift analysis across 3+ config files.
- Failures involving both protocol and bridge round-trip timing.
- Situations where fixes in one layer create regressions in another.

**Trigger phrases:** "hangs forever", "works in one client only", "still broken after restart".

## Execution Strategy

### Sequential (Default)
1. Reproduce.
2. Confirm state.
3. Patch one layer.
4. Validate handshake + tool call.

### Parallelizable
- Config file comparisons across clients.
- Static validation of tool catalog vs adapter registration.

### Subagent Candidates
| Task | Agent Type | When to Spawn |
|------|------------|---------------|
| Broad file discovery | Explore | When unsure where launch config is defined |
| Test output triage | execution-focused | When many logs need concise failure extraction |

## Context Management

### Approximate Token Footprint
- Skill base: ~3k
- With scripts + data loaded: ~5k
- With full runtime logs: ~8k+

### Context Optimization
- Load only the failing layer’s files first.
- Keep logs trimmed to handshake + first failing call.
- Use data catalog reference instead of re-listing tool names.

### When Context Gets Tight
- Prioritize: current failing state, command path, handshake evidence.
- Defer: broad integration commentary and historical changes.
- Drop: unrelated client configs.

## Example Interaction

**User:** "MCP server starts but initialize hangs forever"

**Your approach:**
1. Classify as `SPM2`.
2. Run protocol smoke against exact launch command.
3. If smoke passes, check stale processes and restart host.
4. Re-run and verify `tools/list`.

**User:** "It works in Codex but not in VS Code"

**Your approach:**
1. Classify as `SPM5`.
2. Compare both client configs for command/env mismatch.
3. Normalize to shared wrapper and pinned versions.
4. Validate both clients after restart.

## What You Do NOT Do

- You do not rewrite the full architecture for isolated startup bugs.
- You do not treat plugin/API business logic issues as protocol issues without evidence.
- You do not add duplicate MCP server ids to "fix" discovery.
- You do not leave fixes unverified with a real handshake test.

## Integration Graph

### Inbound (From Other Skills)
| Source Skill | Source State | Leads to State |
|--------------|--------------|----------------|
| mcp-security-audit | Unpinned or conflicting MCP config entries | SPM5: Multi-Config Inconsistency |
| systematic-debugging | Repro established, root cause unknown | SPM1–SPM4 |

### Outbound (To Other Skills)
| This State | Leads to Skill | Target State |
|------------|----------------|--------------|
| SPM5: Multi-Config Inconsistency | mcp-security-audit | Config hardening + pinning |
| SPM4: Bridge Round-Trip Timeout | debugging-strategies | Runtime instrumentation / root cause narrowing |

### Complementary Skills
| Skill | Relationship |
|-------|--------------|
| mcp-security-audit | Secures and standardizes MCP config surface |
| systematic-debugging | General root-cause loop for non-protocol defects |
| skill-builder | Evolves this skill from real failure artifacts |

## Verification (Oracle)

### What This Skill Can Verify
- Launch command exists and is executable (High).
- `initialize` response shape is valid JSON-RPC/MCP (High).
- Required tool names exist in `tools/list` (High).
- IPC directory presence and basic accessibility (Medium).

### What Requires Human Judgment
- Whether a timeout is caused by plugin runtime internals vs user workflow timing.
- Whether to patch adapter naming or preserve backward compatibility.
- Whether observed config drift is intentional.

## Output Persistence

### Output Location
Persist artifacts in this skill folder:
- `./.agents/super-productivity-mcp/SKILL.md`
- `./.agents/super-productivity-mcp/scripts/`
- `./.agents/super-productivity-mcp/data/`
- `./.agents/super-productivity-mcp/references/`

### What to Save
- Reusable diagnostics scripts.
- Canonical tool catalog.
- Minimal checklists for protocol/runtime validation.

## Design Constraints

### This Skill Assumes
- Local access to MCP config and repo files.
- Ability to run a direct launch command for smoke testing.

### This Skill Does Not Handle
- Super Productivity app feature design requests unrelated to MCP reliability.
- Generic non-MCP debugging where no MCP handshake/tooling is involved.
