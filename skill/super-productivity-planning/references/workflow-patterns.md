# Workflow Patterns

Short examples of common working routines, written as calls to this suite's
MCP tools. Each pattern adapts an idea from the Super Productivity blog; the
source is linked under its heading. The examples use only fields that exist in
`internal/catalog/tools.json` today.

## Contents

- [How to use these patterns](#how-to-use-these-patterns)
- [Which interface you are talking to](#which-interface-you-are-talking-to)
- [Handoff](#handoff)
- [Technical spike](#technical-spike)
- [Work log](#work-log)
- [Waiting For](#waiting-for)
- [Daily review](#daily-review)
- [Shutdown](#shutdown)

## How to use these patterns

- Run a pattern when the user asks for it. Do not create recurring tasks or
  schedule the routine itself.
- Keep shared evidence (decisions, test results, review comments) in the issue,
  pull request or document the team already uses. A task note holds the
  personal next action and a link to that record.
- `update_task` with `notes` replaces the whole note. Read the task with
  `get_task` first, add to the existing text, show the user the full new note
  and write it only after they agree. Never shorten or reword a note on your
  own.
- Use tags and projects that already exist (`get_tags`, `get_projects`). If a
  pattern needs a tag the user does not have, ask before calling `create_tag`.
- Pass `literal: true` when a title contains `#`, `+`, `@` or an estimate such
  as `30m`, so short syntax does not turn an issue number into a tag.
- Titles use the form `[Category] Task: detail`.
- Summaries in these patterns are the agent's own reading of the tool results
  in the conversation. Nothing here adds an automatic summarizer.

## Which interface you are talking to

Super Productivity has several ways in. They have different permissions and
different tool schemas; do not mix their arguments.

| Interface | Where it runs | What it can do |
| --- | --- | --- |
| This suite (`sp-mcp`) | Local stdio MCP server talking to the bundled plugin over file IPC, plus the optional Local REST API for archive and restore. | Full task inventory, editing, scheduling and diagnostics, limited by `SP_MCP_SCOPES`. |
| Native app MCP | `http://127.0.0.1:3876/mcp` inside the desktop app, with its own access key. | Active-task reads and Inbox capture. Its `create_task` takes `dueDate`, `dueTime` and `repeat` but not this suite's other fields. |
| Local REST API | `http://127.0.0.1:3876` with a separate access token. | Scripts and this suite's REST routes. Not an MCP interface. |
| SuperSync capture | The sync server's `/mcp` endpoint, for cloud assistants. | Adds tasks to the Inbox. It cannot read or edit existing tasks. |
| AI Command | A planned upstream plugin that sends a request to a model provider. | Not part of this suite; these patterns do not use it. |

## Handoff

Source: [Developer handoff checklist](https://super-productivity.com/blog/developer-handoff-checklist/).

Use this when the user passes unfinished work to someone else. The handoff
itself goes in the shared record; the task keeps only the user's follow-up.

1. Read the task: `get_task {"taskId": "<task-id>"}`.
2. Draft the handoff for the shared record (the issue or pull request), with:
   - the request and its boundary: investigate, implement, review or deploy;
   - the current state, revision and environment;
   - what was verified, with links to the evidence, kept apart from what was
     changed but not checked;
   - open questions and hypotheses, labelled as such;
   - the next check and the result it should show;
   - one owner, a fallback, and a reply-by date with its timezone.
3. Read the draft as the recipient would. If they could not tell what is
   verified, what is open and what to do next, fix it before posting.
4. Create the user's own follow-up after they approve it:

   ```json
   {
     "tool": "create_task",
     "arguments": {
       "title": "[Work] Follow up: confirm Dana picked up the export bug in #482",
       "notes": "Handoff posted in https://git.example.com/acme/app/issues/482#comment-17. Next action: check for Dana's acknowledgment; if none by Thursday 12:00 America/Chicago, ask Sam (fallback owner).",
       "projectId": "<existing-project-id>",
       "literal": true
     }
   }
   ```

## Technical spike

Source: [Technical spike template](https://super-productivity.com/blog/technical-spike-template/).

A spike answers one question that blocks a decision, within a time budget.

1. Write the purpose as one sentence: "We need to learn X so we can decide Y."
   If the user cannot fill in Y, the work is not a spike yet.
2. Check existing docs, tests and earlier work before planning new checks.
3. Create the task with the question, the decision, the smallest check that
   could change it, and the stopping point:

   ```json
   {
     "tool": "create_task",
     "arguments": {
       "title": "[Work] Spike: can the importer stream 50 MB CSV files under 512 MB RAM",
       "notes": "Question: does the current importer stay under 512 MB on a 50 MB CSV?\nDecision it informs: stream rows (keep the importer) or move imports to the batch worker.\nSmallest check: import the 50 MB fixture once with memory profiling on.\nBudget: 90 minutes; stop and report when it runs out.\nResults go in: https://git.example.com/acme/app/issues/510",
       "timeEstimate": 5400000,
       "projectId": "<existing-project-id>",
       "literal": true
     }
   }
   ```

4. Record inputs and conditions in the issue before interpreting results.
5. Close with one of four outcomes: answered, ruled out, could not run, or
   incomplete. One sample does not prove the whole system safe. Label any
   prototype code as experimental.

## Work log

Source: [Developer work log template](https://super-productivity.com/blog/developer-work-log-template/).

The log records outcomes, blockers and restart points, not activity.

1. Read the day's tracked time:
   `get_worklog {"startDate": "2026-11-09", "endDate": "2026-11-09", "includeArchived": true}`.
2. For each task with time, report its outcome, the time spent against its
   `timeEstimate`, any blocker or decision, and the cue for resuming it. Ask the
   user for outcomes the tool results cannot show.
3. Close the day with two lines the user confirms: one useful result and one
   adjustment for tomorrow. Put them where the user keeps such notes; do not
   create a task for them unless asked.
4. For a weekly review, read the week
   (`get_worklog {"startDate": "2026-11-02", "endDate": "2026-11-08", "includeArchived": true}`) and
   produce a calibration note (estimates against time spent), a status update
   and one change for next week.

Elapsed time is not a performance score. Keep secrets and private notes out
of anything shared with a team.

`get_worklog` counts leaf tasks only, so a parent's rolled-up time is not
added twice. Pass `includeArchived: true` for history that includes archived
tasks, and check `coverage.complete` before calling a total complete.

## Waiting For

A Waiting For item is work blocked on someone else. The pattern keeps who and
since when in the task, so the review can chase it.

1. Find the tag the user already uses for this (`get_tags`). If there is none,
   ask whether to create one with `create_tag {"title": "Waiting"}`.
2. Tag the task: `add_tag_to_task {"taskId": "<task-id>", "tagId": "<waiting-tag-id>"}`.
3. With the user's approval, add a line to the existing note:
   `Waiting on: Priya for the staging credentials, asked 2026-11-09 in https://chat.example.com/c/ops/88. Next action if no answer by 2026-11-12: ask in #ops.`
4. During a review, list them:
   `get_tasks {"tagId": "<waiting-tag-id>", "includeDone": false, "fields": ["id", "title", "dueDay", "notes"]}`.
   Report each item's age and next action. Change a date only when the user
   asks.
5. When the answer arrives, remove the tag with `remove_tag_from_task` and
   record the result in the shared record.

## Daily review

A read-only check at the start of the day. It proposes changes; it does not
make them.

1. `get_status` to confirm the bridge is ready and which scopes are granted.
2. `get_schedule_health {"date": "2026-11-09"}` for planned, overdue,
   unscheduled and stale counts.
3. `get_tasks {"overdue": true, "includeDone": false, "fields": ["id", "title", "dueDay", "projectId"]}`
   for overdue items.
4. `get_current_task` to see whether a timer is still running from yesterday.
5. Present a short list: what is planned, what is overdue, what is waiting,
   and up to three proposed changes. Apply a change only after the user picks
   it, then follow the planning runbook's verification step.

## Shutdown

An end-of-day close that leaves a restart point.

1. `get_current_task`. If a task is running and the user is done, call
   `stop_task`.
2. Read today's time with `get_worklog` and confirm the day's result with the
   user, as in [Work log](#work-log).
3. For the task the user will resume tomorrow, propose one line for its note,
   such as
   `Restart: rerun the failing test in importer_test.go:214 with the 50 MB fixture; the timeout fix is on branch fix/import-timeout.`
   Write it with `update_task` only after the user approves the full note.
4. Do not reschedule unfinished work at shutdown unless the user asks; the
   next daily review covers it.
