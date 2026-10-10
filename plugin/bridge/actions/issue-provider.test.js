const test = require("node:test");
const assert = require("node:assert/strict");
const handlers = require("./issue-provider");
const attach = handlers["issueProvider.attachGitea"];
const list = handlers["issueProvider.listConnections"];
const secret = "test-secret-not-in-response";
let providers, actions, reads;
function setup(initial = []) {
  providers = structuredClone(initial); actions = []; reads = 0;
  global.PluginAPI = {
    getAllProjects: async () => [{id: "p1"}],
    getIssueProviderConnections: async () => providers,
    executeNodeScript: async () => { reads++; return {result: {token: secret}}; },
    dispatchAction: async a => {
      actions.push(a);
      if (a.type.includes("Add IssueProvider")) providers.push(a.issueProvider);
      else Object.assign(providers.find(p => p.id === a.issueProvider.id), a.issueProvider.changes);
    },
  };
}
const input = {projectId: "p1", host: "https://git.example.com", repoFullname: "owner/repo", tokenFile: "/private/token"};
const provider = () => ({id: "old-id", issueProviderKey: "GITEA", defaultProjectId: "p1", isEnabled: true, isAutoPoll: true, isAutoAddToBacklog: false, pollingMode: "whenProjectOpen", pluginConfig: {host: input.host, repoFullname: input.repoFullname, scope: "all", token: secret}});
test("dry run plans attachment without reading token or writing", async () => {
  setup(); const result = await attach(input);
  assert.equal(result.dryRun, true); assert.equal(result.operation, "create");
  assert.equal(reads, 0); assert.equal(actions.length, 0);
});
test("create verifies the connection and excludes credentials", async () => {
  setup(); const result = await attach({...input, dryRun: false, isAutoAddToBacklog: true, pollingMode: "always"});
  assert.equal(result.verified, true); assert.equal(providers.length, 1);
  assert.equal(actions[0].meta.opType, "CRT"); assert.equal(actions[0].issueProvider.token, secret);
  assert.ok(!JSON.stringify(result).includes(secret));
});
test("repeat apply reuses provider and updates settings", async () => {
  setup([provider()]); const result = await attach({...input, dryRun: false, isAutoAddToBacklog: true});
  assert.equal(result.issueProviderId, "old-id"); assert.equal(providers.length, 1);
  assert.equal(actions[0].meta.opType, "UPD"); assert.equal(providers[0].isAutoAddToBacklog, true);
});
test("duplicate providers require explicit selection", async () => {
  setup([provider(), {...provider(), id: "second"}]);
  await assert.rejects(attach(input), e => /multiple Gitea providers/.test(e.message)); assert.equal(actions.length, 0);
  const result = await attach({...input, providerId: "second", dryRun: false}); assert.equal(result.issueProviderId, "second"); assert.equal(providers.length, 2);
});
test("retargeting requires explicit provider id", async () => {
  setup([provider()]); const next = {...input, repoFullname: "owner/renamed"};
  await assert.rejects(attach(next), e => /another repository/.test(e.message));
  const result = await attach({...next, providerId: "old-id", dryRun: false}); assert.equal(result.repoFullname, "owner/renamed");
});
test("rejects selecting a provider from another project", async () => {
  setup([{...provider(), defaultProjectId: "p2"}]); await assert.rejects(attach({...input, providerId: "old-id"}), e => /belonging to this project/.test(e.message));
});
test("list output strips credentials from native and plugin configs", async () => {
  setup([provider(), {id: "native", issueProviderKey: "GITEA", defaultProjectId: "p2", host: input.host, repoFullname: "x/y", token: secret, otherSecret: secret}]);
  const result = await list(); assert.equal(result.connections.length, 2); assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal((await list({projectId: "p1"})).connections.length, 1);
});
test("unsupported app fails without attempting mutation", async () => {
  setup(); delete PluginAPI.getIssueProviderConnections; await assert.rejects(attach(input), e => /app build/.test(e.message)); assert.equal(actions.length, 0);
});
test("blocked dispatch is surfaced", async () => {
  setup(); PluginAPI.dispatchAction = async () => {throw new Error("Action type is not allowed");};
  await assert.rejects(attach({...input,dryRun:false}), e => /not allowed/.test(e.message));
});
test("unconfirmed write is surfaced rather than reported as success", async () => {
  setup(); PluginAPI.dispatchAction = async () => {};
  await assert.rejects(attach({...input,dryRun:false}), e => /not confirmed/.test(e.message));
});
test("private token permissions are required", async () => {
  setup(); PluginAPI.executeNodeScript = async () => ({result:{error:"TOKEN_FILE_PERMISSIONS"}});
  await assert.rejects(attach({...input,dryRun:false}), e => /chmod 600/.test(e.message)); assert.equal(actions.length, 0);
});
test("validates host, repository and project", async () => {
  setup(); for (const host of ["file:///tmp", "https://name:secret@git.example.com", "https://git.example.com/path"]) await assert.rejects(attach({...input,host}), e => /host/.test(e.message));
  await assert.rejects(attach({...input,repoFullname:"bad"}), e => /owner\/repo/.test(e.message));
  await assert.rejects(attach({...input,projectId:"missing"}), e => /Project does not exist/.test(e.message));
});
