# Gitea repository attachment

The MCP exposes `get_repository_attachments` and `attach_gitea_repository`.
The attachment tool creates or updates a native Gitea provider; it does not mark
issue imports complete. To import future open issues into a project's backlog,
set `isAutoPoll: true`, `isAutoAddToBacklog: true`, and `pollingMode: "always"`.
Imported tasks are not assigned dates by this tool.

## Required app capability

The desktop app must expose `PluginAPI.getIssueProviderConnections()` and allow
`IssueProviderActions.addIssueProvider` and `updateIssueProvider` through its
plugin action allowlist. `app-repository-connections.patch` is a companion patch
against the local Super Productivity source. It returns only credential-free
Gitea metadata and leaves provider deletion/bulk imports blocked. The patch
passes `git apply --check`; it has not been compiled, linted or installed.
Run the app repository's required `npm run checkFile` checks on each touched
TypeScript file, its plugin API tests, and an app build before installing it.

## Use

1. List existing attachments, optionally with `projectId`.
2. Preview `attach_gitea_repository` with `projectId`, Gitea base `host`, and
   `repoFullname` (`owner/repo`). Dry-run is the default.
3. When duplicate providers exist, choose `providerId` explicitly. When
   retargeting a stale connection, explicitly choose that provider too.
4. Apply with `dryRun: false` and `tokenFile`, an absolute private file on the
   desktop app host. The token stays inside the app and never enters MCP
   request/response files. Group/world-readable files are rejected.
5. Read the returned verified connection and separately check that expected
   issue IDs appear in the project's backlog. Attachment success is not proof
   that Gitea authentication or polling has succeeded.

Existing provider IDs are reused. Neither duplicate providers nor project data
are deleted. Default auto-add is false; enabling it is an explicit choice.

## Install state

This implementation is on branch `codex/gitea-repository-attachment` in the
adjacent worktree. It has not replaced the currently running MCP or plugin.
Build/package both suite artifacts from this checkout, install the compatible
app build and upload the plugin ZIP, then reconnect the MCP client. The live
repository sync remains pending until the new capability passes a read-only
connection probe and a controlled attachment call.
