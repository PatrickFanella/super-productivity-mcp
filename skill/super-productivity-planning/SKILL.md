---
name: super-productivity-planning
description: Plan and modify Super Productivity tasks through Inbox triage, task normalization, estimate/tag/project/date changes, overdue or unscheduled cleanup, and realistic time-block scheduling. Use when the user explicitly requests task hygiene or a daily schedule; use super-productivity-maintenance for audit-first periodic reviews and super-productivity-mcp when tools are unhealthy.
---

# Super Productivity Planning

Treat planning as a controlled transaction over live personal task data.

## References

- Read `references/planning-runbook.md` before broad or mutating work.
- Read `references/verification-checklist.md` before reporting a full overhaul
  or any guarantee such as “nothing remains unscheduled.”

## Gates

- Verify the configured Super Productivity MCP exists and is healthy.
- Route runtime, bridge, protocol, catalog, or client failures to
  `super-productivity-mcp`.
- Never fall back to shell or GUI automation for live task mutations.
- Establish date, timezone, horizon, work budget, and whether subtasks are in
  scope before scheduling.

## Transaction

1. **Inventory:** Read projects, tags, active/current tasks, Inbox, overdue,
   target dates, unscheduled work, and relevant subtasks.
2. **Propose:** Define compact changes, scheduling capacity, and invariants.
3. **Dry run:** Use native dry-run tools when available; otherwise present a
   bounded change summary before broad mutations.
4. **Apply:** Mutate in conservative batches within the requested scope.
5. **Verify:** Re-read every affected surface; never treat intended payloads as
   proof.

Require confirmation before deleting, bulk-completing, rewriting recurrence, or
broadly changing titles, notes, projects, subtasks, or taxonomy beyond the
explicit request.

## Scheduling Defaults

- Keep focused task capacity near six hours unless the user chooses otherwise.
- Reserve time for routines, breaks, transitions, chores, recovery, and
  interruptions.
- Prefer 15–30 minute checklist items and 45–90 minute bounded work; split work
  larger than two hours unless it is intentionally one focus block.
- Use the MCP's timezone-aware date conversion tool, such as
  `make_planned_at`, with an explicit named timezone. Never hand-calculate
  `plannedAt`.
- Extend the horizon rather than overfilling days when complete scheduling is
  requested.

## Completion Contract

For a full overhaul, report:

- active counts with and without subtasks;
- unscheduled and Inbox counts;
- stale-date and overdue counts;
- schedule horizons for top-level and all active tasks;
- the requested-day plan;
- any unknown or nonzero invariant.

If fresh reads cannot prove an invariant, mark the pass partial.
