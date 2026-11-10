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
| Suite commit | `2ad4ee03bc4166279220c0e954a2c6698df51147` (main after the review fixes, #57–#59) |
| Local gates | `make verify-release` passed (catalog and doc drift, Go, JS, end-to-end, evals, install profiles, plugin package) |
| `plugin.js` SHA-256 | `4085f2c702505e1ad4bf75cac54c80324a2891152e05320f4a2d4b35a1ac956b` |
| Plugin ZIP | `super-productivity-mcp-plugin-v0.1.0.zip`; its hash changes with file timestamps, so record the one you install |
| Hosted CI | Gitea Actions `CI / test` passed on every merged PR head (#37–#59) |
| Review | Three independent reviews of the night's changes (Go routes, JS parity, contract and docs); their findings are fixed in #57, #58 and #59 |
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
