const test = require("node:test");
const assert = require("node:assert/strict");

const issueProviderActions = require("./issue-provider");

const create = issueProviderActions["issueProvider.createGitea"];

function mockPluginAPI({ tokenResult = { token: "secret-token" } } = {}) {
  const dispatched = [];
  const scripts = [];
  global.PluginAPI = {
    getAllProjects: async () => [{ id: "proj-1", title: "clpr" }],
    executeNodeScript: async (req) => {
      scripts.push(req);
      return { success: true, result: tokenResult };
    },
    dispatchAction: async (action) => {
      dispatched.push(action);
    },
  };
  return { dispatched, scripts };
}

test("issueProvider.createGitea dispatches a persistent Gitea provider for the project", async () => {
  const { dispatched, scripts } = mockPluginAPI();

  const out = await create({
    projectId: "proj-1",
    host: "https://git.example.com/",
    repoFullname: "org/clpr",
    tokenFile: "/home/me/.config/gitea-token",
  });

  assert.deepEqual(out, {
    issueProviderId: "mcp_gitea_proj-1",
    projectId: "proj-1",
    repoFullname: "org/clpr",
    scope: "all",
    created: true,
  });
  assert.deepEqual(scripts[0].args, ["/home/me/.config/gitea-token"]);
  assert.equal(dispatched.length, 1);
  const action = dispatched[0];
  assert.equal(action.type, "[IssueProvider/API] Add IssueProvider");
  assert.deepEqual(action.meta, {
    isPersistent: true,
    entityType: "ISSUE_PROVIDER",
    entityId: "mcp_gitea_proj-1",
    opType: "CRT",
  });
  const provider = action.issueProvider;
  assert.equal(provider.issueProviderKey, "GITEA");
  assert.equal(provider.pluginId, "gitea-issue-provider");
  assert.equal(provider.defaultProjectId, "proj-1");
  assert.equal(provider.isAutoPoll, true);
  assert.equal(provider.isAutoAddToBacklog, false);
  assert.deepEqual(provider.pluginConfig, {
    host: "https://git.example.com",
    token: "secret-token",
    repoFullname: "org/clpr",
    scope: "all",
    filterLabels: "",
    excludeLabels: "",
  });
});

test("issueProvider.createGitea never returns the token", async () => {
  mockPluginAPI();
  const out = await create({
    projectId: "proj-1",
    host: "https://git.example.com",
    repoFullname: "org/clpr",
    tokenFile: "/tmp/token",
  });
  assert.equal(JSON.stringify(out).includes("secret-token"), false);
});

test("issueProvider.createGitea rejects group- or world-readable token files", async () => {
  const { dispatched } = mockPluginAPI({ tokenResult: { error: "TOKEN_FILE_PERMISSIONS" } });
  await assert.rejects(
    create({ projectId: "proj-1", host: "https://git.example.com", repoFullname: "org/clpr", tokenFile: "/tmp/token" }),
    (err) => err.code === "TOKEN_FILE_PERMISSIONS",
  );
  assert.equal(dispatched.length, 0);
});

test("issueProvider.createGitea validates project, repo, host, scope and token path", async () => {
  mockPluginAPI();
  const base = { projectId: "proj-1", host: "https://git.example.com", repoFullname: "org/clpr", tokenFile: "/tmp/token" };
  await assert.rejects(create({ ...base, projectId: "missing" }), (err) => err.code === "PROJECT_NOT_FOUND");
  await assert.rejects(create({ ...base, repoFullname: "clpr" }), (err) => err.code === "INVALID_REQUEST");
  await assert.rejects(create({ ...base, host: "git.example.com" }), (err) => err.code === "INVALID_REQUEST");
  await assert.rejects(create({ ...base, scope: "everything" }), (err) => err.code === "INVALID_REQUEST");
  await assert.rejects(create({ ...base, tokenFile: "relative/token" }), (err) => err.code === "INVALID_REQUEST");
});
