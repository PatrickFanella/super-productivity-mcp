# Super Productivity Planning Verification Checklist

Use this checklist before declaring a planning pass complete.

## Data Integrity

- [ ] MCP bridge responded successfully after mutations.
- [ ] Fresh task reads were used for verification, not cached inventory.
- [ ] No intended batch update returned an error.
- [ ] Created projects/tags, if any, were explicitly requested or confirmed.
- [ ] No tasks were deleted or bulk-completed without explicit approval.

## Scheduling Invariants

- [ ] Active unscheduled task count is zero when the user requested complete
      scheduling.
- [ ] Active unscheduled subtask count is zero when subtasks are in scope.
- [ ] No active top-level Inbox tasks remain after an Inbox-zero triage request.
- [ ] Stale planned dates named by the user were cleared or rescheduled.
- [ ] No overdue active task remains before the new anchor date unless it is a
      deliberate true deadline exception.
- [ ] Top-level tasks have a clear schedule horizon.
- [ ] All active tasks including subtasks have a clear schedule horizon when the
      user requested full coverage.

## Task Hygiene

- [ ] Vague active tasks have clearer titles or notes.
- [ ] Broad singleton tasks have subtasks or a clear next-action note.
- [ ] Estimates are present and plausible for active scheduled work.
- [ ] Parent task estimates were not accidentally inflated by subtask totals.
- [ ] Tags are compact enough to be useful and not just historical clutter.

## Daily Plan Quality

- [ ] The requested day starts at the requested time.
- [ ] The day includes breaks, routines, chores, and shutdown if requested.
- [ ] The day leaves explicit misc/buffer time.
- [ ] Scheduled work does not exceed the user’s requested work budget.
- [ ] Focus blocks are large enough to be useful and not fragmented into noise.

## Final Response

Include these numbers for a full overhaul:

- active task count including subtasks;
- active top-level task count;
- unscheduled active task count;
- active top-level Inbox count;
- stale planned-date count for the cleared date(s);
- overdue count before the anchor date;
- schedule horizon for top-level tasks;
- schedule horizon for all active tasks including subtasks;
- final requested-day schedule.

If any item cannot be verified, report it as unknown rather than complete.
