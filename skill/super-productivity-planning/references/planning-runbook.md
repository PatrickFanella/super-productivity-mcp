# Super Productivity Planning Runbook

## Contents

- [Inputs](#inputs)
- [Inventory](#inventory)
- [Transaction pattern](#transaction-pattern)
- [Hygiene rules](#hygiene-rules)
- [Inbox triage](#inbox-triage)
- [Scheduling](#scheduling)
- [Verification and report](#verification-and-report)

## Inputs

Resolve before writes:

- anchor date and named timezone;
- what “today” means across midnight;
- requested start time, working window, and planning horizon;
- whether subtasks and recurring templates are in scope;
- permission to create projects/tags or perform broad rewrites.

## Inventory

Collect a fresh read-only snapshot:

- MCP and bridge health;
- projects, Inbox ID, and tags;
- current task and active top-level tasks;
- active Inbox, overdue, target-day, stale-date, and unscheduled tasks;
- active subtasks and their date/tag inheritance behavior.

Stop and route to `super-productivity-mcp` if the tool surface is unhealthy.

## Transaction Pattern

1. Capture rollback evidence as `{id, changed fields, previous values}`.
2. Build a compact proposed-change summary grouped by operation.
3. Use native dry-run tools where available.
4. Apply no more than 25 items per batch unless the tool documents a lower
   limit.
5. Re-read the affected items after each major batch.
6. Stop on unexpected errors or invariant drift; do not compound a partial
   mutation.

Require confirmation for broad mutations that were not explicit in the user's
request. Never delete, bulk-complete, or rewrite recurring templates without
explicit confirmation.

## Hygiene Rules

- Make titles specific and imperative while preserving meaningful wording.
- Add notes only when they clarify next action, scope, context, or acceptance
  criteria.
- Add subtasks only to genuinely broad work.
- Keep true due dates distinct from planned work.
- Resolve existing tags by title and consolidate only when aliases are clearly
  redundant.
- Do not invent a canonical taxonomy or create projects/tags without approval.

## Inbox Triage

For each active Inbox item:

1. Classify it as active work, reference, recurring work, or backlog.
2. Route active work to the appropriate existing project.
3. Add only the context needed to make the next action clear.
4. Add a plausible estimate and existing useful tags.
5. Schedule it, or deliberately leave it in backlog with the user's approval.

Inbox zero means no active top-level capture items remain unintentionally.

## Scheduling

1. Convert local dates/times with the MCP's timezone-aware conversion tool.
2. Build the requested day first.
3. Place priority and stale work into useful focus blocks.
4. Preserve the user's routines and add requested breaks, chores, buffers, and
   shutdown.
5. Spread remaining work across future days within the chosen capacity.
6. Continue beyond the initial horizon rather than overfilling days when full
   coverage is required.

When subtasks need dates, inherit the parent's date unless the work genuinely
spans multiple days.

## Verification and Report

Use fresh task reads plus schedule-range or schedule-health evidence in the
named timezone. Apply `references/verification-checklist.md`, then report:

- before/after counts where useful;
- changes grouped by type;
- final requested-day schedule;
- schedule horizon and remaining exceptions;
- rollback or partial-mutation information when applicable.
