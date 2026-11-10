# v20 qualification report

Procedure: [`v20-qualification.md`](v20-qualification.md).

## Status: incomplete

The live checks have not been run. They need the owner at a desktop with a
disposable stock-v20 profile: Local REST is enabled, its token copied and the
plugin installed through the app's UI, and the issue requires a human
checkpoint for them. The machine these changes were made on runs headless.
Until a live run is recorded below, the v20 compatibility release is
**qualified by fixtures and CI only**.

## Automated evidence

Recorded on 2026-11-10.

| Item | Value |
| --- | --- |
| Suite commit | `5ede0f5e57cd0fb06ed0937912610baaef1cbee8` (main after #54) |
| Local gates | `make verify-release` passed (catalog and doc drift, Go, JS, end-to-end, evals, install profiles, plugin package) |
| `plugin.js` SHA-256 | `69c3254ce9a6ed6ed0b58d038b07e1642787f554d27377f4c71d442a74be9a47` |
| Plugin ZIP | `super-productivity-mcp-plugin-v0.1.0.zip`; its hash changes with file timestamps, so record the one you install |
| Hosted CI | Gitea Actions `CI / test` passed on every merged PR head for #14–#32 and #17 |
| Upstream contract | v20.0.0, commit `4db0e11236bc784d3184a9e252930b4bd53df823` (source read, not run) |

What this evidence covers: request shapes, envelope handling, routing,
validation and both plugin projections, against synthetic fixtures and fakes
of the documented v20 routes. What it does not cover: the running app's
behavior, reminders and Today in the UI, the plugin sandbox, real tokens,
real timing, and client tool refresh.

## Live run

| Item | Value |
| --- | --- |
| Date | not run |
| App build and SHA-256 | |
| Operating system | |
| Suite commit | |
| Adapters | |
| Checklist results | |
| Temporary data accounted for | |
| Rollback rehearsal | |
