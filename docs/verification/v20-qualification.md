# Qualifying the suite on stock Super Productivity v20

This is the repeatable live check for the v20 compatibility release (roadmap
#11, issues #30 and #34). It runs against a **disposable** app profile with
synthetic data only. Fixture tests, CI and packaged-artifact checks are
separate evidence and do not replace it. Record every run in
[`v20-qualification-report.md`](v20-qualification-report.md).

Do not run this against your everyday profile, and do not install anything
over your live app. App-data downgrade safety is not tested here: restoring an
older binary does not prove an older app can read data a newer one wrote.

## 1. Record what is being tested

```bash
git rev-parse HEAD                      # suite commit
make verify-release                     # local gates + package-plugin
sha256sum plugin.js super-productivity-mcp-plugin-v*.zip
```

Also record: the app version and the SHA-256 of the v20 binary you run, the
hosted CI run for the same commit, the operating system, and which adapters
the run configures (plugin only, plugin + REST, REST with the plugin off).

## 2. Prepare a disposable profile

1. Quit any running Super Productivity, or at least switch off its Local REST
   API: the API's port (3876) is fixed, and two apps cannot both listen.
2. Download the v20.0.0 release build for your platform from
   <https://github.com/super-productivity/super-productivity/releases/tag/v20.0.0>
   and record its SHA-256.
3. Start it with an empty profile and its own home directory, so the plugin
   creates a separate IPC directory instead of reusing your live one. The
   plugin refuses data directories under `/tmp`, so keep it in your home:

   ```bash
   export QUAL=$(mktemp -d "$HOME/sp-v20-qualification.XXXXXX")
   mkdir -p "$QUAL/home" "$QUAL/profile"
   # The plugin follows ~/.local/share/super-productivity-mcp/mcp_config.json
   # if it exists; move it aside for the run or the disposable plugin will
   # use your live IPC directory.
   test ! -e "$HOME/.local/share/super-productivity-mcp/mcp_config.json" || echo "move mcp_config.json aside first"
   HOME="$QUAL/home" ./superProductivity-*.AppImage --user-data-dir="$QUAL/profile"
   ```

4. In the app: **Settings → Misc → Enable local REST API**; copy the
   **Access Token** into a `0600` file such as `$QUAL/token`. Keep it out of
   shell history and command lines.
5. Install the plugin from `super-productivity-mcp-plugin-v*.zip` built in
   step 1 and allow Node execution when asked. The plugin log should show
   `MCP Bridge v2 ready` with a base directory under
   `$QUAL/home/.local/share/super-productivity-mcp`. If it shows any other
   directory, stop: it is not isolated.
6. Create the synthetic data the checks need, all titled with a
   `[QUAL]` prefix: two projects, one tag, a parent task with two subtasks,
   and three standalone tasks.

## 3. Run the MCP server against it

Use a separate MCP client entry, never your everyday one:

```bash
export SP_MCP_DATA_DIR="$QUAL/home/.local/share/super-productivity-mcp"
export SP_LOCAL_REST_URL=http://127.0.0.1:3876
export SP_LOCAL_REST_TOKEN="$(cat "$QUAL/token")"
./sp-mcp            # or point an MCP client at it with these variables
```

For the plugin-only run, unset `SP_LOCAL_REST_URL`. For the REST-only run,
disable the plugin in the app and keep REST configured.

## 4. Checklist

Each line is a tool call and the readback that proves it. Mark it passed,
failed (with the error code) or not run. Readbacks use a fresh call, never
the write's own result.

### Status and routing (#26)

- [ ] `get_status` with both adapters: `readiness: ready`.
- [ ] Plugin disabled: `readiness: partial`, answered within a few seconds.
- [ ] Wrong token: `localRest.error.code` is `LOCAL_REST_UNAUTHORIZED`.
- [ ] `bridge_capabilities`: `operations` show the expected adapter per tool.

### Schedule, Today and DST (#19, #20, #21)

- [ ] `update_task` with `dueWithTime` then `get_schedule_range`: the task is
      on that day, and the app shows the same time and its reminder.
- [ ] `update_task` with `dueWithTime: null`: the time and reminder are gone
      in the app.
- [ ] Set the app's start of the next day to 04:00; a task at 02:00 tomorrow
      appears in `get_tasks {tagId: "TODAY"}` and in the app's Today.
- [ ] `plan_tasks_for_today` adds a day-only task to the app's Today.
- [ ] `auto_schedule_tasks` dry run writes nothing; applying it places tasks
      without overlapping an existing timed task.
- [ ] `make_planned_at` refuses 2026-03-08 02:30 and asks to disambiguate
      2026-11-01 01:30 for America/Chicago.

### Deadlines (#27)

- [ ] `update_task {deadlineDay}` shows the deadline in the app; a deadline
      of today moves the task to Today as the deadline dialog does.
- [ ] `clear_schedule_for_day` leaves deadlines unchanged.

### Tracking and time (#16, #28, #29)

- [ ] `start_task` on the parent tracks its first unfinished subtask
      (`trackedTaskId`); `get_current_task` and `stop_task` agree with the app.
- [ ] `add_time_to_task` on a subtask: that day's record and the parent total
      change once. `set_task_time_for_day` twice changes nothing the second
      time; `0` clears the day.
- [ ] `add_time_to_task` on the parent is refused; a future date is refused.
- [ ] `get_worklog {includeArchived: true}` counts each subtask once and
      reports `coverage.complete: true`.

### Recurrence (#22, #23, #24)

- [ ] `create_task` with `repeat {cycle: "weekly", weekdays: ["tue", "thu"]}`
      creates one task and one repeat config (`get_task_recurrence`).
- [ ] `update_task_recurrence {changes: {isPaused: true}}`, then resume.
- [ ] `update_task_recurrence {changes: {startTime: "09:00"}}` is refused
      with `UNSUPPORTED_FIELD` and the config is unchanged.
- [ ] `delete_task_recurrence`: the tasks remain and no longer repeat.

### Archive and restore (#15, #25)

- [ ] `archive_task` on a parent: it and its subtasks leave the active list
      and appear in `get_tasks {source: "archived"}`; `restore_task` brings
      them back.
- [ ] With the plugin disabled, archive and restore still work.

### Scopes and clients

- [ ] `SP_MCP_SCOPES=read`: write tools and note tools are hidden; resources
      other than `sp://notes` read.
- [ ] `SP_MCP_SCOPES=create`: only creation and status tools are listed.
- [ ] Reconnect an MCP client after upgrading and confirm it sees the new
      tools (`get_task_recurrences`, `set_task_time_for_day`, ...).
- [ ] `get_repository_attachments` on a project with a fixture Gitea
      attachment answers without error.

### Quick add

- [ ] `sp-quick-add --title "[QUAL] quick add @today 15m" --no-notify`
      creates exactly one task, with the estimate applied.

### Additive tools (#34)

- [ ] Notes: with `read` alone `get_notes` is hidden; with `read,notes` it
      lists a project note and a Today note with their placement.
      `create_note`, a move with `update_note`, and `delete_note` read back.
- [ ] Focus: `get_focus_state` reports `inactive`, then `work-running` and
      `work-paused` while you run a Pomodoro in the app.
- [ ] Habits: `get_habit_history` shows units; `set_habit_value_for_day` for
      yesterday twice keeps the other days; scalar `get_counters` still works.

## 5. Clean up and account for everything

- [ ] Every `[QUAL]` task, repeat config, note, time entry and habit value is
      listed in the report and deleted (or the profile is deleted whole).
- [ ] Remove `$QUAL` and the token file; regenerate nothing in your live app.

## 6. Rehearse rollback

On the disposable profile only:

1. Keep the previous suite artifacts as one set: `sp-mcp`, `sp-quick-add`,
   the plugin ZIP and the MCP client configuration.
2. Install the previous set, reconnect the client, and confirm `get_status`
   and one read work.
3. Reinstall the new set and confirm the same.

Record the result. This rehearses the suite's own rollback; it says nothing
about downgrading the app's data.
