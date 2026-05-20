---
name: super-productivity-planning
description: Super Productivity task planning, hygiene, inbox triage, and time-block scheduling workflow. Use when the user asks to clean up tasks, empty or triage the Inbox, normalize titles/descriptions/subtasks/estimates/tags, reschedule overdue/today/unscheduled work, create a realistic daily plan with breaks/routines/buffers, or verify that active work is fully scheduled.
---

# Super Productivity Planning

## Overview

Run Super Productivity task cleanup and schedule planning as a controlled data
maintenance operation. This skill owns task hygiene, inbox triage, estimate
normalization, tag simplification, and time-block scheduling.

## Load-on-Demand References

- Read `references/planning-runbook.md` before any broad or mutating planning
  pass.
- Read `references/verification-checklist.md` before the final report or when
  the user asks for strong guarantees such as “nothing unscheduled remains.”

## Boundaries

- Use `super-productivity-mcp` instead when the MCP server, plugin bridge,
  protocol, catalog, or client config is failing.
- Use `super-productivity-maintenance` instead when the user wants a high-level
  periodic audit and has not yet selected task planning as the lane.
- Do not delete, bulk-complete, or rewrite recurring templates without explicit
  confirmation.

## Default Workflow

1. **Establish anchors.** Confirm the meaning of “today,” start time, planning
   horizon, workday budget, timezone, and whether all active tasks or only
   top-level tasks must be scheduled.
2. **Inventory first.** Query projects, tags, current task, active tasks,
   inbox tasks, overdue tasks, target-day planned tasks, unscheduled tasks,
   and subtasks before deciding what to change.
3. **Design hygiene rules.** Define the compact tag taxonomy, title/description
   standards, estimate defaults, subtask policy, and scheduling budget before
   batch updates.
4. **Triage Inbox and stale dates.** Route active Inbox work into real projects,
   clear stale planned dates, preserve true deadlines, and avoid losing context.
5. **Normalize tasks.** Improve vague titles, add notes/descriptions where
   needed, create subtasks for broad singleton tasks, and keep estimates
   realistic.
6. **Build the schedule.** Time-block from the requested start time, include
   routines, breaks, chores, shutdown, and misc buffers, then spread remaining
   work across future dates without overfilling days.
7. **Verify invariants.** Re-query the data after mutation. Do not rely on the
   intended batch payload as proof.

## Scheduling Defaults

- Keep daily planned task capacity near 6 focused hours unless the user asks
  for more. Use the remaining day for routines, buffers, breaks, chores,
  transitions, and unexpected work.
- Prefer 15–30 minute estimates for checklist subtasks, 45–90 minutes for
  bounded implementation/admin tasks, and split anything larger than 2 hours.
- Preserve slack. A “full day” should still have recovery and misc work space.
- Schedule every active task if the user asks for complete hygiene, even if the
  fallback horizon extends beyond the next two weeks.

## Verification Contract

For a full overhaul, report these checks explicitly:

- active task count including subtasks;
- active top-level task count;
- unscheduled active task count;
- Inbox active top-level count;
- stale planned-date count for any cleared anchor date;
- overdue count before the new anchor date;
- schedule horizon for top-level tasks and for all active tasks;
- the final time-block plan for the requested day.

If any check is nonzero or unknown, say so and either fix it or mark the pass
partial.
