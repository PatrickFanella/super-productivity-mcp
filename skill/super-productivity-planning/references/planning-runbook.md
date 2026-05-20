# Super Productivity Planning Runbook

Use this runbook for broad or mutating Super Productivity cleanup passes. The
goal is to make live task data coherent, scheduled, and usable without erasing
context or overfilling the calendar.

## 1. Establish Inputs

Capture these before writing data:

- anchor date and timezone;
- what the user means by “today” if the conversation crosses midnight;
- schedule start time and desired working-window length;
- planning horizon and whether it may extend past two weeks;
- whether all active tasks, including subtasks, must be scheduled;
- permission for creating projects/tags or changing recurring templates.

Use todos for any multi-step overhaul. Include final verification as a todo
from the start.

## 2. Inventory Checklist

Collect a read-only snapshot first:

- MCP bridge health and available tool names;
- projects and the Inbox project id;
- tags, including obvious duplicates and over-specific clusters;
- current active task and recent worklog if useful for routine/context clues;
- active top-level tasks;
- active Inbox tasks;
- overdue tasks before the new anchor date;
- tasks planned for stale dates that must be cleared;
- tasks planned for the target day;
- unscheduled active tasks;
- active subtasks and whether they inherit parent dates/tags.

If MCP calls fail, stop planning and switch to `super-productivity-mcp`.

## 3. Hygiene Rules

Apply rules consistently before batching mutations:

- **Titles:** Make active task titles specific, imperative, and typo-clean.
  Preserve the user’s wording when it carries meaning.
- **Descriptions/notes:** Add notes when a title alone does not define the next
  action, scope, acceptance criteria, or context.
- **Subtasks:** Add subtasks for broad singleton tasks. Avoid creating subtasks
  for already atomic work.
- **Estimates:** Use 15–30 minutes for checklist subtasks, 45–90 minutes for
  bounded work, and split anything larger than 2 hours unless it is intentionally
  a large focus block.
- **Deadlines vs plans:** Preserve true due dates. Move stale planned work to new
  planned dates instead of treating every old planned date as a hard deadline.
- **Recurring work:** Do not rewrite recurring templates without explicit user
  confirmation.

## 4. Tag Taxonomy

Prefer a compact taxonomy of roughly 12–15 active-use tags. A good default set:

- Project
- Routine
- Planning
- Focus Block
- Admin
- Backlog
- Review
- Shutdown
- Chores
- Health
- Development
- Content
- Social
- Research
- Personal

Resolve existing tags by title instead of hard-coding ids. Create missing
canonical tags only after user confirmation. Remove overly specific scheduling
or technology tags from active tasks only when they are not serving a real
filtering/reporting purpose.

## 5. Inbox Triage

For each active Inbox task:

1. Decide whether it is real active work, reference material, recurring/routine
   work, or backlog.
2. Route active work into the appropriate project.
3. Add enough notes/subtasks to make the next action clear.
4. Assign estimates and tags.
5. Schedule it or explicitly place it in a future backlog/review slot.

Do not leave active top-level tasks in Inbox after a full triage pass unless the
user asks to preserve Inbox as a capture queue.

## 6. Scheduling Algorithm

Build the requested day first, then spread remaining work:

1. Start at the user’s requested time.
2. Insert launch/routine, breaks, meal/reset, chores/errands, misc buffer, and
   shutdown blocks if the user asked for a humane daily plan.
3. Schedule high-priority or stale work into focus blocks.
4. Keep focused task capacity near 6 hours/day by default, with remaining time
   reserved for routines, admin, transition cost, interruptions, and recovery.
5. Spread the rest across future workdays with similar capacity limits.
6. If the user requires every active task to be scheduled, continue past the
   initial horizon until no active task or subtask is unscheduled.

When subtasks must be scheduled, prefer the parent’s planned date/tags unless
there is a clear reason to distribute subtasks across multiple days.

## 7. MCP Execution Notes

- Prefer official MCP tools exposed by `tools/list`.
- If a documented helper is unavailable, use the supported lower-level tools or
  direct newline-delimited JSON-RPC against the configured MCP binary only after
  confirming the server’s actual protocol behavior.
- Batch updates in conservative chunks and re-query after each major wave.
- Never treat a successful batch call as proof that all intended invariants now
  hold; verify from fresh reads.

## 8. Final Report Shape

Report:

- counts before/after if useful;
- new or changed organizing surfaces;
- taxonomy used;
- final requested-day schedule;
- verification checklist results;
- any intentionally deferred work or remaining risk.
