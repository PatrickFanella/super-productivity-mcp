const { typedError } = require("../errors");
const { valueOf } = require("./task-common");

const ADD_ISSUE_PROVIDER = "[IssueProvider/API] Add IssueProvider";
const GITEA_PLUGIN_ID = "gitea-issue-provider";
const GITEA_SCOPES = new Set(["all", "created-by-me", "assigned-to-me"]);

function assertDispatchActionAvailable() {
  if (typeof PluginAPI.dispatchAction !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "PluginAPI.dispatchAction is required for issue provider tools", false);
  }
}

// Deterministic id: one Gitea provider per project. Re-running the call is a
// no-op because the reducer's addOne ignores an id that already exists.
function giteaProviderId(projectId) {
  return `mcp_gitea_${projectId}`;
}

function normalizeHost(value) {
  if (typeof value !== "string" || !/^https?:\/\/[^\s/]+/.test(value)) {
    throw typedError("INVALID_REQUEST", "host must be an http(s) URL", false);
  }
  return value.replace(/\/+$/, "");
}

function normalizeRepoFullname(value) {
  if (typeof value !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value)) {
    throw typedError("INVALID_REQUEST", "repoFullname must look like owner/repo", false);
  }
  return value;
}

function normalizeScope(value) {
  if (value == null) return "all";
  if (!GITEA_SCOPES.has(value)) {
    throw typedError("INVALID_REQUEST", `scope must be one of ${[...GITEA_SCOPES].join(", ")}`, false);
  }
  return value;
}

// The token is read inside Super Productivity from a local file so it never
// travels through IPC request files, responses, or logs.
async function readTokenFile(tokenFile) {
  if (typeof tokenFile !== "string" || !tokenFile.startsWith("/")) {
    throw typedError("INVALID_REQUEST", "tokenFile must be an absolute path", false);
  }
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const st = fs.statSync(args[0]);
      if ((st.mode & 0o077) !== 0) return { error: 'TOKEN_FILE_PERMISSIONS' };
      const token = fs.readFileSync(args[0], 'utf8').trim();
      if (!token) return { error: 'TOKEN_FILE_EMPTY' };
      return { token };
    `,
    args: [tokenFile],
    timeout: 5000,
  });
  if (result?.success === false) {
    throw typedError("TOKEN_FILE_UNREADABLE", "Could not read tokenFile", false);
  }
  const out = result?.result ?? result;
  if (out?.error === "TOKEN_FILE_PERMISSIONS") {
    throw typedError("TOKEN_FILE_PERMISSIONS", "tokenFile must not be readable by group or others (chmod 600)", false);
  }
  if (out?.error === "TOKEN_FILE_EMPTY" || !out?.token) {
    throw typedError("TOKEN_FILE_EMPTY", "tokenFile is empty", false);
  }
  return out.token;
}

async function issueProviderCreateGitea(payload) {
  assertDispatchActionAvailable();
  const input = payload || {};
  const projectId = valueOf(input, "projectId", "project_id");
  if (!projectId) throw typedError("INVALID_REQUEST", "projectId is required", false);
  const projects = await PluginAPI.getAllProjects();
  if (!projects.some((p) => p.id === projectId)) {
    throw typedError("PROJECT_NOT_FOUND", `Project ${projectId} not found`, false);
  }
  const host = normalizeHost(input.host);
  const repoFullname = normalizeRepoFullname(valueOf(input, "repoFullname", "repo_full_name"));
  const scope = normalizeScope(input.scope);
  const token = await readTokenFile(valueOf(input, "tokenFile", "token_file"));

  const autoPoll = valueOf(input, "isAutoPoll", "is_auto_poll");
  const autoAdd = valueOf(input, "isAutoAddToBacklog", "is_auto_add_to_backlog");
  const id = giteaProviderId(projectId);
  const issueProvider = {
    id,
    isEnabled: true,
    issueProviderKey: "GITEA",
    isAutoPoll: autoPoll == null ? true : autoPoll === true,
    isAutoAddToBacklog: autoAdd === true,
    isIntegratedAddTaskBar: false,
    defaultProjectId: projectId,
    pinnedSearch: null,
    pollingMode: "whenProjectOpen",
    defaultTagIds: [],
    defaultNote: null,
    pluginId: GITEA_PLUGIN_ID,
    pluginConfig: {
      host,
      token,
      repoFullname,
      scope,
      filterLabels: valueOf(input, "filterLabels", "filter_labels") || "",
      excludeLabels: valueOf(input, "excludeLabels", "exclude_labels") || "",
    },
  };

  await PluginAPI.dispatchAction({
    type: ADD_ISSUE_PROVIDER,
    issueProvider,
    meta: { isPersistent: true, entityType: "ISSUE_PROVIDER", entityId: id, opType: "CRT" },
  });
  return { issueProviderId: id, projectId, repoFullname, scope, created: true };
}

module.exports = {
  "issueProvider.createGitea": issueProviderCreateGitea,
};
