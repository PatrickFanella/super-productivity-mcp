---
name: super-productivity-maintenance
description: High-level Super Productivity maintenance and routing runbook. Use when the user asks to clean up, audit, maintain, reset, or run a daily/weekly/monthly pass over Super Productivity; coordinates MCP health checks, task planning, inbox triage, schedule hygiene, and follow-up reporting by routing to the focused Super Productivity skills.
---

# Super Productivity Maintenance

## Overview

Coordinate a high-level Super Productivity maintenance pass without mixing
runtime diagnostics, task planning, and review work into one blob. Use this
skill as the router and runbook for deciding which focused Super Productivity
workflow should own each lane.

## Skill Boundaries

Use the three-skill split deliberately:

- `super-productivity-mcp` — MCP health, development, bridge reliability,
  protocol smoke tests, tool/resource catalog drift, install/config issues.
- `super-productivity-maintenance` — high-level periodic upkeep, system audit,
  routing, scope control, and final maintenance report.
- `super-productivity-planning` — task hygiene, inbox triage, estimates,
  tag simplification, overdue/today/unscheduled cleanup, and time-block
  scheduling.

If the request is entirely one lane, load the focused skill and do not keep
this maintenance wrapper in the foreground.

## Maintenance Workflow

1. **Clarify the maintenance goal.** Establish date, timezone, desired horizon,
   whether live task mutation is allowed, and whether the user wants a light
   audit or a full overhaul.
2. **Health gate the MCP.** If any Super Productivity call fails, stalls, or
   reports missing tools/resources, switch to `super-productivity-mcp` before
   modifying data.
3. **Inventory the system.** Collect projects, tags, current task, active tasks,
   inbox tasks, overdue tasks, tasks planned for the relevant dates,
   unscheduled tasks, and obvious recurring/routine surfaces.
4. **Route the work.** Use `super-productivity-planning` for any mutation pass
   that touches task hygiene, estimates, tags, inbox, or scheduling. Keep this
   skill responsible for scope, priorities, and final reporting.
5. **Preserve slack.** Unless explicitly told otherwise, maintenance should not
   fill every open minute. Leave room for miscellaneous work, recovery,
   interruptions, and routines.
6. **Verify before reporting.** Do not claim the system is clean until targeted
   checks prove the requested invariants.

## Safety Rules

- Treat Super Productivity as a live personal operating system, not a test
  fixture. Prefer reversible changes.
- Ask before deleting tasks, bulk-completing tasks, changing recurring
  templates, or creating broad new taxonomy surfaces.
- Avoid hard-coded project or tag IDs. Resolve names to IDs from the current
  instance before writing.
- Preserve deadlines separately from planned work blocks when the MCP exposes
  both concepts.
- Use todos for multi-step maintenance passes and include the final
  verification task from the start.

## Standard Output

Return a compact maintenance report with:

- scope and anchor dates used;
- lanes executed and any focused skills used;
- important changes made;
- verification results, including remaining known gaps;
- the next schedule or next recommended maintenance pass.

If the pass was intentionally partial, say what was not touched.
