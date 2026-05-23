# MCP Tool and Resource Catalog

Generated from `internal/catalog/tools.json`. Do not edit by hand; run `make generate-docs`.

## Tools

| Tool | Action | Description |
| --- | --- | --- |
| `create_task` | `task.create` | Create a new task in Super Productivity. Supports short syntax in title: #tag, +project, @due, estimates like 30m or 1h/2h. |
| `get_tasks` | `task.list` | List tasks from Super Productivity |
| `create_task_with_subtasks` | `task.createWithSubtasks` | Create a parent task and subtasks in one operation. Supports short syntax in parent and subtask titles. |
| `get_archived_tasks` | `task.listArchived` | List archived tasks when PluginAPI.getArchivedTasks is available; supports the same shaping fields as get_tasks. |
| `get_current_context_tasks` | `task.listCurrentContext` | List tasks from Super Productivity's current context when PluginAPI.getCurrentContextTasks is available. |
| `get_task` | `task.get` | Get a specific task by ID |
| `update_task` | `task.update` | Update an existing task |
| `set_task_recurrence` | `task.setRecurrence` | Make an existing Super Productivity task recurring by creating and linking a TaskRepeatCfg. Requires a Super Productivity build that allows repeat cfg plugin actions. |
| `update_task_recurrence` | `task.updateRecurrence` | Update the repeat config linked to an existing recurring task. Requires the task to already have repeatCfgId. |
| `delete_task_recurrence` | `task.deleteRecurrence` | Remove recurrence from a recurring task by deleting its TaskRepeatCfg and unlinking task instances. |
| `complete_task` | `task.complete` | Mark a task as done |
| `uncomplete_task` | `task.uncomplete` | Unmark a task as done |
| `archive_task` | `task.archive` | True-archive a task via optional Local REST. Requires SP_LOCAL_REST_URL/SUPER_PRODUCTIVITY_REST_URL; without REST this errors unless allowDoneFallback:true explicitly accepts marking the task done instead. |
| `restore_task` | `task.restore` | Restore an archived task through the optional Local REST API. Requires SP_LOCAL_REST_URL or SUPER_PRODUCTIVITY_REST_URL; no plugin fallback exists. |
| `delete_task` | `task.delete` | Delete a task permanently when the Super Productivity plugin runtime supports deleteTask |
| `add_time_to_task` | `task.addTime` | Add tracked time to a task (timeMs is duration in milliseconds) |
| `start_task` | `task.start` | Start time tracking on a task, stopping any other active task first |
| `stop_task` | `task.stop` | Stop the currently running time tracker; idempotent when nothing is running |
| `get_current_task` | `task.current` | Get the currently tracked task, or null when no timer is running |
| `get_worklog` | `task.worklog` | Summarize tracked task time for a date range from Super Productivity worklog fields |
| `bulk_complete_tasks` | `task.bulkComplete` | Mark multiple tasks complete with per-task partial success results |
| `bulk_update_tasks` | `task.bulkUpdate` | Update multiple tasks with per-task partial success results. Use dryRun:true to preview field diffs without mutation before broad edits. |
| `bulk_reschedule_tasks` | `task.bulkReschedule` | Update only schedule fields (plannedAt, dueDay, timeEstimate) for multiple tasks. Prefer dryRun:true first for schedule-wide changes. |
| `clear_schedule_for_day` | `task.clearScheduleForDay` | Clear plannedAt for tasks planned on a local YYYY-MM-DD, optionally clearing matching dueDay values. Use dryRun:true to preview changed tasks first. |
| `get_schedule_health` | `task.scheduleHealth` | Summarize schedule hygiene counts and concise task lists for cleanup planning |
| `get_schedule_range` | `task.scheduleRange` | Read planned tasks grouped by local date for a date range |
| `find_stale_schedule` | `task.findStaleSchedule` | Find active tasks planned or due before a cutoff date |
| `find_unscheduled_active_tasks` | `task.findUnscheduledActive` | Find active tasks with no plannedAt and no dueDay using project/tag/estimate filters |
| `make_planned_at` | `task.makePlannedAt` | Convert a local date/time and timezone into a plannedAt timestamp |
| `auto_schedule_tasks` | `task.autoSchedule` | Dry-run-first scheduler for unscheduled active tasks using daily capacity. Applying schedules requires dryRun:false and confirmApply:true. |
| `compact_task_notes` | `task.compactNotes` | Replace oversized task notes with caller-provided replacementNotes. Defaults to dry-run; applying requires dryRun:false and confirmApply:true. |
| `plan_tasks_for_today` | `task.planToday` | Plan or unplan multiple tasks for today using plannedAt |
| `add_tag_to_task` | `task.addTag` | Add one tag to a task without replacing existing tags; idempotent if already present |
| `remove_tag_from_task` | `task.removeTag` | Remove one tag from a task without replacing other tags; errors if absent |
| `move_task_to_project` | `task.moveToProject` | Move a top-level task to a project; rejects subtasks |
| `reorder_task` | `task.reorder` | Reorder tasks within a project or tag context |
| `reorder_tasks` | `task.reorderTasks` | Upstream-compatible alias for reordering tasks within a project, tag, or parent task context |
| `get_projects` | `project.list` | List all projects |
| `create_project` | `project.create` | Create a new project |
| `update_project` | `project.update` | Update an existing project |
| `get_tags` | `tag.list` | List all tags |
| `create_tag` | `tag.create` | Create a new tag |
| `update_tag` | `tag.update` | Update an existing tag |
| `show_notification` | `notification.show` | Show a notification in Super Productivity |
| `notify_user` | `notification.notify` | Send a Super Productivity notification through PluginAPI.notify when available |
| `get_counters` | `counter.list` | List all plugin counters when PluginAPI.getAllCounters is available |
| `get_counter` | `counter.get` | Read one plugin counter by id when PluginAPI.getCounter is available |
| `set_counter` | `counter.set` | Set one plugin counter by id when PluginAPI.setCounter is available |
| `increment_counter` | `counter.increment` | Increment one plugin counter by id; delta defaults to 1 |
| `decrement_counter` | `counter.decrement` | Decrement one plugin counter by id; delta defaults to 1 |
| `delete_counter` | `counter.delete` | Delete one plugin counter by id when PluginAPI.deleteCounter is available |
| `bridge_health` | `bridge.health` | Check if the SP plugin bridge is healthy and responding |
| `check_connection` | `bridge.checkConnection` | Upstream-compatible alias for checking whether Super Productivity and the plugin bridge are responding |
| `debug_directories` | `bridge.debugDirectories` | Show resolved plugin bridge IPC directories for diagnostics |
| `bridge_capabilities` | `bridge.capabilities` | Get the SP plugin bridge capabilities and supported actions |

## Resources

| URI | Action | Description |
| --- | --- | --- |
| `sp://projects` | `project.list` | All Super Productivity projects |
| `sp://tags` | `tag.list` | All Super Productivity tags |
| `sp://tasks/active` | `task.list` | Incomplete active tasks |
| `sp://tasks/archived` | `task.listArchived` | Archived tasks when the plugin runtime supports archived reads |
| `sp://tasks/current-context` | `task.listCurrentContext` | Tasks from the current Super Productivity context when available |
| `sp://tasks/today` | `task.list` | Incomplete tasks planned for today |
| `sp://tasks/overdue` | `task.list` | Incomplete tasks with due dates before today |
| `sp://tasks/unscheduled` | `task.findUnscheduledActive` | Active top-level tasks with no planned date or due date |
| `sp://schedule/today` | `task.list` | Incomplete tasks planned today with concise synthetic metadata |
| `sp://schedule/health` | `task.scheduleHealth` | Schedule hygiene counts and concise task lists |
| `sp://counters` | `counter.list` | All Super Productivity plugin counters when available |

