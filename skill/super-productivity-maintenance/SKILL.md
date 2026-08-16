---
name: super-productivity-maintenance
description: Audit and coordinate periodic Super Productivity upkeep across MCP health, task planning, Inbox hygiene, schedule review, and follow-up reporting. Use for audit-first daily, weekly, or monthly reviews and mixed maintenance passes; use super-productivity-planning when the request already specifies task cleanup or scheduling, and super-productivity-mcp for runtime failures.
---

# Super Productivity Maintenance

Coordinate mixed or periodic maintenance while keeping runtime diagnosis and
task mutation in their focused workflows.

## Route First

- Use `super-productivity-mcp` for startup, handshake, catalog, IPC, bridge, or
  client-configuration failures.
- Use `super-productivity-planning` for explicit Inbox triage, task
  normalization, estimate/tag/date changes, or time-block scheduling.
- Keep this skill responsible for audit scope, lane selection, and the final
  maintenance report.

If one focused lane fully owns the request, route to it and keep this wrapper
out of the foreground.

## Workflow

1. Establish the anchor date, timezone, horizon, and desired maintenance depth.
2. Choose `audit-only` or `approved overhaul`.
   - In audit-only mode, inventory and report without writes.
   - In overhaul mode, keep writes within the user's requested scope and route
     mutations to the focused skill.
3. Health-gate the MCP before reading or modifying live task data.
4. Inventory only the surfaces required by the selected lanes.
5. Run independent read-heavy lane audits in parallel when useful. Centralize
   all live mutations and verification.
6. Preserve deadlines, routines, and scheduling slack.
7. Re-query affected surfaces before reporting completion.

Use a task-tracking tool for a multi-step overhaul when one is available, and
include verification from the start.

## Safety

- Treat Super Productivity as live personal data.
- Prefer reversible changes.
- Require explicit confirmation before deleting tasks, bulk-completing tasks,
  rewriting recurring templates, or creating broad taxonomy surfaces.
- Resolve project and tag names from the live instance; never hard-code IDs.
- Keep true deadlines distinct from planned work blocks.

## Output

Return:

- scope, mode, timezone, and anchor dates;
- lanes and focused skills used;
- important changes, or findings for audit-only work;
- fresh verification and remaining gaps;
- recommended next maintenance point.

State clearly when a pass was intentionally partial.
