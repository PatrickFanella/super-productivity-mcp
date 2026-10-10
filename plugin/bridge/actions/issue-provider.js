const { typedError } = require("../errors");

const UPDATE_ISSUE_PROVIDER = "[IssueProvider/API] Update IssueProvider";
const ADD_ISSUE_PROVIDER = "[IssueProvider/API] Add IssueProvider";
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
  if (typeof value !== "string" || !/^https?:\/\/[^\s/@?#]+(?::[0-9]+)?\/?$/.test(value)) {
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

function connection(provider) {
  const cfg = provider.host ? provider : (provider.pluginConfig || provider);
  return {
    id: provider.id, projectId: provider.defaultProjectId ?? provider.projectId,
    issueProviderKey: provider.issueProviderKey, isEnabled: provider.isEnabled,
    host: cfg.host, repoFullname: cfg.repoFullname, scope: cfg.scope,
    filterLabels: cfg.filterLabels || "", excludeLabels: cfg.excludeLabels || "",
    isAutoPoll: provider.isAutoPoll, isAutoAddToBacklog: provider.isAutoAddToBacklog,
    pollingMode: provider.pollingMode,
  };
}

async function readConnections() {
  if (typeof PluginAPI.getIssueProviderConnections !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "Repository attachment requires an app build exposing PluginAPI.getIssueProviderConnections and allowing IssueProvider add/update actions", false);
  }
  return (await PluginAPI.getIssueProviderConnections()).filter(p => p.issueProviderKey === "GITEA").map(connection);
}

async function listConnections(payload = {}) {
  const all = await readConnections();
  return { connections: all.filter(p => !payload.projectId || p.projectId === payload.projectId) };
}

async function attachGitea(payload = {}) {
  assertDispatchActionAvailable();
  const projectId = payload.projectId;
  if (!projectId) throw typedError("INVALID_REQUEST", "projectId is required", false);
  if (!(await PluginAPI.getAllProjects()).some(p => p.id === projectId)) {
    throw typedError("PROJECT_NOT_FOUND", "Project does not exist", false);
  }
  const host = normalizeHost(payload.host);
  const repoFullname = normalizeRepoFullname(payload.repoFullname);
  const all = await readConnections();
  const candidates = all.filter(p => p.projectId === projectId);
  let existing;
  if (payload.providerId) {
    existing = candidates.find(p => p.id === payload.providerId);
    if (!existing) throw typedError("PROVIDER_NOT_FOUND", "providerId must identify a Gitea provider belonging to this project", false);
  } else {
    if (candidates.length > 1) throw typedError("AMBIGUOUS_PROVIDER", "Project has multiple Gitea providers; list connections and explicitly select providerId", false);
    existing = candidates[0];
    if (existing && (existing.host !== host || existing.repoFullname.toLowerCase() !== repoFullname.toLowerCase())) {
      throw typedError("REPOSITORY_CONFLICT", "Project is connected to another repository; select providerId explicitly to retarget it", false);
    }
  }
  const id = existing ? existing.id : giteaProviderId(projectId);
  if (!existing && all.some(p => p.id === id)) throw typedError("PROVIDER_ID_CONFLICT", "Generated provider id belongs to another project", false);
  const cfg = {
    host, repoFullname, scope: normalizeScope(payload.scope ?? existing?.scope),
    filterLabels: payload.filterLabels ?? existing?.filterLabels ?? "",
    excludeLabels: payload.excludeLabels ?? existing?.excludeLabels ?? "",
  };
  const settings = {
    isEnabled: true, defaultProjectId: projectId,
    isAutoPoll: payload.isAutoPoll ?? existing?.isAutoPoll ?? true,
    isAutoAddToBacklog: payload.isAutoAddToBacklog ?? existing?.isAutoAddToBacklog ?? false,
    pollingMode: payload.pollingMode ?? existing?.pollingMode ?? "whenProjectOpen",
  };
  if (!["whenProjectOpen", "always"].includes(settings.pollingMode)) throw typedError("INVALID_REQUEST", "Invalid pollingMode", false);
  const result = { issueProviderId: id, projectId, ...cfg, ...settings, operation: existing ? "update" : "create" };
  if (payload.dryRun !== false) return { ...result, dryRun: true };
  const token = await readTokenFile(payload.tokenFile);
  const changes = { ...settings, ...cfg, token };
  const action = existing ? {
    type: UPDATE_ISSUE_PROVIDER, issueProvider: { id, changes },
  } : {
    type: ADD_ISSUE_PROVIDER, issueProvider: {
      id, issueProviderKey: "GITEA",
      pinnedSearch: null, defaultTagIds: [], defaultNote: null,
      isIntegratedAddTaskBar: false, ...changes,
    },
  };
  action.meta = { isPersistent: true, entityType: "ISSUE_PROVIDER", entityId: id, opType: existing ? "UPD" : "CRT" };
  await PluginAPI.dispatchAction(action);
  const verified = (await readConnections()).find(p => p.id === id);
  if (!verified || verified.host !== host || verified.repoFullname !== repoFullname || Object.entries({ ...cfg, ...settings }).some(([k,v]) => (k === "defaultProjectId" ? verified.projectId : verified[k]) !== v)) {
    throw typedError("ATTACHMENT_NOT_VERIFIED", "Provider action was dispatched but the requested connection was not confirmed; reread connections before retrying", false);
  }
  return { ...result, dryRun: false, verified: true };
}

module.exports = {
  "issueProvider.listConnections": listConnections,
  "issueProvider.attachGitea": attachGitea,
};
