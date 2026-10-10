# Gitea repository attachment

The MCP exposes `get_repository_attachments` and `attach_gitea_repository`.
The attachment tool creates or updates a Gitea provider; it does not mark
issue imports complete. To import future open issues into a project's backlog,
set `isAutoPoll: true`, `isAutoAddToBacklog: true`, and `pollingMode: "always"`.
Imported tasks are not assigned dates by this tool.

## Required app capability

The desktop app must expose `PluginAPI.getIssueProviderConnections()` and allow
`IssueProviderActions.addIssueProvider` and `updateIssueProvider` through its
plugin action allowlist. `app-repository-connections.patch` is a companion patch
against official Super Productivity v19.1.0. It includes both iframe method
allowlists, returns only credential-free Gitea metadata, and leaves provider
deletion/bulk imports blocked. All eight changed TypeScript files passed their
required `checkFile` checks. The production frontend and Electron builds passed;
68 targeted plugin API, bridge, provider metadata and action allowlist tests passed.
The companion patch also fixes backlog pagination: it continues through empty-page
termination even when Gitea caps results below the requested limit. A capped
50 + 15 + empty page regression check passed, as did provider typechecking and
checkFile. It requests issues separately from pull requests.

Super Productivity 19.1.0 stores Gitea settings and credentials under
`pluginConfig` with `pluginId: "gitea-issue-provider"`. New connections use that
format; explicitly reported legacy native providers retain their original format.

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

## Installation

Build/package the MCP plugin from the same checkout as this compatibility fix.
Apply the companion patch to v19.1.0, build/install the desktop app, upload the
plugin ZIP, and reconnect the MCP client. Verify a read-only attachment probe
before applying changes. Repository issue sync is complete only after the
expected imported issue IDs have been checked in each project.
