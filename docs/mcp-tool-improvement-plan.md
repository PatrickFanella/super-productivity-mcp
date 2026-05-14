# MCP Tool Improvement Plan

Context: this plan comes from a full-app schedule cleanup session where the MCP was used to clear today, reschedule all active top-level tasks, fix stale planned dates, add estimates/due dates, and compact oversized roadmap notes.

## Top priorities

### 1. `clear_schedule_for_day(date)`

One call to clear a day’s schedule.

Recommended behavior:

- Remove `plannedAt` for all tasks planned on the given local date.
- Optionally clear `dueDay` when requested.
- Exclude completed/archived tasks by default.
- Return changed task count plus a task-level diff.

Why: clearing today required manual filtering plus bulk updates across generated recurring tasks and normal tasks.

### 2. `get_schedule_health()`

One diagnostic summary for schedule cleanup.

Recommended output:

- Planned-today count.
- Overdue active task count.
- Unscheduled active top-level task count.
- Stale planned/due task count.
- Tasks missing estimates.
- Tasks with oversized notes.
- Generated recurring tasks present in active views.
- Tasks with suspicious dates or impossible estimates.

Why: “tighten the entire app” needs a health snapshot before and after changes.

### 3. `auto_schedule_tasks(args)`

Plan unscheduled/stale tasks into a realistic future schedule.

Suggested args:

```ts
{
  startDate: string;
  endDate?: string;
  timezone: string;
  capacityPerDayMinutes: number;
  workHours?: { start: string; end: string }[];
  includeProjectIds?: string[];
  excludeProjectIds?: string[];
  includeTags?: string[];
  dryRun?: boolean;
  rules?: {
    maxTasksPerDay?: number;
    preserveExistingPlannedAt?: boolean;
    prioritizeOverdue?: boolean;
    prioritizeStalePlanned?: boolean;
    topLevelOnly?: boolean;
  };
}
```

Why: schedule-wide planning required manual timestamp generation, priority grouping, and capacity balancing.

## Safety improvements

### 4. Dry-run mode for bulk changes

Add `dryRun` to bulk update/reschedule APIs, or add `preview_bulk_update()`.

Diff should show:

- Task title and id.
- Old `plannedAt`, `dueDay`, `timeEstimate`.
- New `plannedAt`, `dueDay`, `timeEstimate`.
- Whether the task is recurring/generated/completed/archived.

Why: schedule-wide edits are high-risk. Preview makes destructive schedule rewrites safer.

### 5. Purpose-built `bulk_reschedule_tasks()`

Accept only schedule fields:

```ts
{
  updates: Array<{
    taskId: string;
    plannedAt?: number | null;
    dueDay?: string | null;
    timeEstimate?: number;
  }>;
  dryRun?: boolean;
}
```

Why: current full `bulk_update_tasks` requires carrying unrelated fields and increases accidental overwrite risk.

### 6. Real `archive_task`

Implement true archive support in the plugin bridge/app API.

Why: current archive fallback can only mark a task done when the app-side API lacks archive support. That is not semantically equivalent.

## Discovery/query improvements

### 7. Better `get_tasks` output shaping

Improve task reads with:

- Reliable `fields` selector support.
- Project title.
- Parent title.
- Subtask count.
- Note length/size.
- Generated recurring marker.
- Archive/completion status.

Why: schedule cleanup needs concise task metadata, not full noisy payloads.

### 8. `find_stale_schedule(args)`

Find tasks planned/due before a cutoff.

Suggested args:

```ts
{
  beforeDate: string;
  includeDueDay?: boolean;
  includePlannedAt?: boolean;
  includeCompleted?: boolean;
  includeArchived?: boolean;
}
```

Why: stale planned blocks were only discovered through broad task inspection.

### 9. `find_unscheduled_active_tasks(args)`

Directly return active tasks needing schedule decisions.

Suggested filters:

- Top-level only.
- Project/tag include/exclude.
- Missing estimate only.
- Missing due date only.

Why: “all active top-level tasks scheduled” should be verifiable with one focused call.

## Note/roadmap hygiene

### 10. `compact_task_notes(taskId, strategy)`

Purpose-built note compaction for huge task notes.

Strategies:

- `summary-only`
- `roadmap-review`
- `archive-original-and-summarize`
- `extract-checklist-to-subtasks`

Why: giant roadmap/checklist notes made task payloads hard to inspect and schedule.

## Date/time correctness

### 11. `make_planned_at(args)`

Timezone-safe helper for planned timestamps.

Suggested args:

```ts
{
  date: string;
  time: string;
  timezone: string;
}
```

Returns:

```ts
{
  plannedAt: number;
  iso: string;
  timezone: string;
}
```

Why: manual timestamp math is error-prone, especially with local timezone assumptions.

### 12. Date-range schedule read

Add `get_schedule_range({ startDate, endDate, timezone })`.

Return tasks grouped by date and ordered by `plannedAt`.

Why: post-change verification should show the actual future schedule, not require many filtered calls.

## Recommended implementation order

1. `clear_schedule_for_day(date)`
2. `get_schedule_health()`
3. Dry-run support for bulk updates/reschedules
4. `bulk_reschedule_tasks()`
5. `find_stale_schedule()` and `find_unscheduled_active_tasks()`
6. Real `archive_task`
7. `auto_schedule_tasks()`
8. Better `get_tasks` shaping
9. `compact_task_notes()`
10. Timezone/date helpers and schedule range reads

## Minimum viable milestone

Ship these first:

- `clear_schedule_for_day(date)`
- `get_schedule_health()`
- `bulk_reschedule_tasks({ updates, dryRun })`

These three remove most friction from safe, whole-app schedule cleanup.
