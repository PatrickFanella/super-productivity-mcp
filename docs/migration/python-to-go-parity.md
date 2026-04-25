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
| `debug_directories` | n/a | `bridge.health` | replaced by capability/health |

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
2. Rich natural-language syntax parsing in Go service (kept in plugin/SP side).
3. Advanced event stream subscriptions beyond file events directory.

## Parity acceptance checklist

- [ ] task create/list/update/complete/uncomplete/archive/addTime/reorder
- [ ] project create/list/update
- [ ] tag create/list/update
- [ ] notification show
- [ ] bridge health + capabilities
- [ ] structured failure payloads
