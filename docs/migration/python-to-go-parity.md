# Python → Go parity matrix

## Current Python behavior inventory

| Python tool | Python plugin action | Canonical action (Go) | Parity target |
| --- | --- | --- | --- |
| `create_task` | `addTask` | `task.create` | carry-over |
| `get_tasks` | `getTasks` | `task.list` | carry-over + fix filter behavior |
| `update_task` | `updateTask` | `task.update` | carry-over |
| `complete_and_archive_task` | `setTaskDone` | `task.complete` / `task.archive` | fix semantic split |
| `get_projects` | `getAllProjects` | `project.list` | carry-over |
| `create_project` | `addProject` | `project.create` | carry-over |
| `get_tags` | `getAllTags` | `tag.list` | carry-over |
| `create_tag` | `addTag` | `tag.create` | carry-over |
| `show_notification` | `showSnack` | `notification.show` | carry-over + typed args |
| `debug_directories` | n/a | `bridge.debugDirectories` | restored as diagnostics alias |
| `check_connection` | `ping` | `bridge.checkConnection` | upstream-compatible alias |
| `create_task_with_subtasks` | `createTaskWithSubtasks` | `task.createWithSubtasks` | added |
| `delete_task` | `deleteTask` | `task.delete` | added; errors if runtime lacks `deleteTask` |
| `start_task` / `stop_task` / `get_current_task` | timer helpers | `task.start` / `task.stop` / `task.current` | added |
| bulk/tag/project modifiers | bulk/tag/project helpers | `task.bulk*`, `task.addTag`, `task.removeTag`, `task.moveToProject` | added |
| `get_worklog` | n/a | `task.worklog` | added from SP worklog fields |
| resources | n/a | `resources/list` + `resources/read` | added: projects, tags, today, overdue |

## Confirmed gaps/bugs in Python implementation

1. `include_done` is accepted but ignored by `get_tasks`.
2. `complete_and_archive_task` does not archive; it only marks done.
3. `show_notification` always maps to a thin snack call without full type mapping.
4. `parse_task_syntax()` exists but is effectively unused in behavior path.
5. File correlation uses mtimes and polling; race-prone under load.
6. `merge_config.py` is corrupted/duplicated and not reliable.
7. `start_mcp_server.sh` is interactive and user-specific.

## Intentional fixes in Go rewrite

1. Protocol v2 with ID-based request/response correlation.
2. Separate completion and archival semantics.
3. Typed protocol errors.
4. Atomic writes and explicit inbox/processing/outbox lifecycle.
5. Non-interactive launcher and client examples instead of merge helper.

## Deferred items

1. Local HTTP/socket API adapter runtime (service seam left ready).
2. Rich natural-language syntax parsing beyond current `#tag`, `+project`, `@due`, and estimate tokens.
3. Advanced event stream subscriptions beyond file events directory.

## Parity acceptance checklist

- [x] task create/list/update/complete/uncomplete/archive/delete/addTime/reorder
- [x] task subtasks, timers, bulk ops, tag/project modifiers, worklog
- [x] project create/list/update
- [x] tag create/list/update
- [x] notification show
- [x] bridge health + capabilities + compatibility diagnostics
- [x] MCP resources for projects, tags, today, overdue
- [x] structured failure payloads
