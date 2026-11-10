// Test harness that runs one catalog action through both bridge projections
// against the same in-memory, stock-v20-shaped PluginAPI:
//
//   - modular: plugin/bridge/actions, called directly;
//   - packaged: the root plugin.js artifact, loaded in a vm context and driven
//     through its real file-IPC inbox/outbox with a private temporary home.
//
// The fake PluginAPI only offers what the pinned v20 plugin API offers to an
// iframe plugin (see README.md). It records every call so tests can assert
// which writes a handler attempted.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const FIXTURE_DIR = __dirname;
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const PACKAGED_PLUGIN = path.join(REPO_ROOT, "plugin.js");

// Upstream ALLOWED_PLUGIN_ACTIONS (src/app/plugins/allowed-plugin-actions.const.ts).
const STOCK_V20_ALLOWED_ACTION_TYPES = new Set([
  "[Layout] Show AddTaskBar",
  "[Layout] Hide AddTaskBar",
  "[Layout] ToggleShow Notes",
  "[Layout] Hide Non-Task Side Panel",
  "[Layout] Toggle IssuePanel",
  "[Layout] Hide PluginPanel",
  "[Layout] Show PluginPanel",
  "[FocusMode] Show Overlay",
  "[FocusMode] Hide Overlay",
  "[Task] Toggle start",
  "[Task] SetCurrentTask",
  "[Task] SetSelectedTask",
  "[WorkContext] Set Active Work Context",
  "[Global Config] Update Global Config Section",
]);

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// createPluginApi returns a fresh stock-v20 PluginAPI over a deep copy of
// tasks.json. `overrides` replaces or removes (with undefined) methods, for
// example to model an older host without getDayContext.
function createPluginApi(overrides = {}) {
  const fixture = loadFixture("tasks.json");
  const counters = loadFixture("simple-counters.json");
  const repeat = loadFixture("repeat-cfgs.json");
  const state = {
    active: new Map(fixture.active.map((task) => [task.id, clone(task)])),
    archived: new Map(fixture.archived.map((task) => [task.id, clone(task)])),
    projects: clone(fixture.projects),
    tags: clone(fixture.tags),
    simpleCounters: clone(counters.simpleCounters),
    pluginCounters: clone(counters.pluginCounters),
    repeatCfgs: new Map(repeat.repeatCfgs.map((cfg) => [cfg.id, clone(cfg)])),
    currentTaskId: null,
    nextId: 1,
  };
  const calls = [];
  const record = (method, ...args) => calls.push({ method, args: clone(args) });

  const api = {
    getTasks: async () => {
      record("getTasks");
      return clone([...state.active.values()]);
    },
    getArchivedTasks: async () => {
      record("getArchivedTasks");
      return clone([...state.archived.values()]);
    },
    getCurrentContextTasks: async () => {
      record("getCurrentContextTasks");
      return clone([...state.active.values()].filter((task) => task.projectId === "fixture-project-alpha"));
    },
    getAllProjects: async () => clone(state.projects),
    getAllTags: async () => clone(state.tags),
    // getAppState returns entity maps, as PluginBridgeService.getAppState does.
    getAppState: async () => {
      record("getAppState");
      const byId = (items) => Object.fromEntries(items.map((item) => [item.id, clone(item)]));
      return {
        tasks: byId([...state.active.values()]),
        projects: byId(state.projects),
        tags: byId(state.tags),
        notes: {},
        taskRepeatCfgs: byId([...state.repeatCfgs.values()]),
        simpleCounters: byId(state.simpleCounters),
        globalConfig: {},
      };
    },
    getDayContext: async () => {
      record("getDayContext");
      return clone(fixture.dayContext);
    },
    updateTask: async (taskId, updates) => {
      record("updateTask", taskId, updates);
      const task = state.active.get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);
      Object.assign(task, updates);
    },
    addTask: async (data) => {
      record("addTask", data);
      const id = `fx-created-${state.nextId++}`;
      state.active.set(id, { id, subTaskIds: [], tagIds: [], timeSpentOnDay: {}, ...clone(data) });
      return id;
    },
    deleteTask: async (taskId) => {
      record("deleteTask", taskId);
      state.active.delete(taskId);
    },
    startTracking: async (taskId) => {
      record("startTracking", taskId);
      state.currentTaskId = taskId;
    },
    stopTracking: async () => {
      record("stopTracking");
      state.currentTaskId = null;
    },
    dispatchAction: async (action) => {
      record("dispatchAction", action);
      if (!STOCK_V20_ALLOWED_ACTION_TYPES.has(action && action.type)) {
        throw new Error(`Action type '${action && action.type}' is not allowed for plugins`);
      }
    },
    getAllCounters: async () => clone(state.pluginCounters),
    getAllSimpleCounters: async () => clone(state.simpleCounters),
    getCounter: async (id) => state.pluginCounters[id] ?? null,
    setCounter: async (id, value) => {
      record("setCounter", id, value);
      state.pluginCounters[id] = value;
    },
    showSnack: async (cfg) => record("showSnack", cfg),
    notify: async (cfg) => record("notify", cfg),
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete api[name];
    else api[name] = value;
  }
  return { api, calls, state, fixture };
}

function writes(calls) {
  return calls.filter((call) => ["updateTask", "addTask", "deleteTask", "startTracking", "stopTracking", "dispatchAction", "setCounter"].includes(call.method));
}

function errorShape(err) {
  return { code: err && err.code ? err.code : "INTERNAL", message: (err && err.message) || String(err) };
}

// runModular calls the modular handler. A thrown error without a code is
// reported as INTERNAL, as plugin/bridge/plugin.js reports it.
async function runModular(api, action, payload = {}) {
  global.PluginAPI = api;
  const handlers = require(path.join(REPO_ROOT, "plugin", "bridge", "actions"));
  const fn = handlers[action];
  if (!fn) return { ok: false, error: { code: "UNSUPPORTED_ACTION", message: `Unsupported action ${action}` } };
  try {
    return { ok: true, result: JSON.parse(JSON.stringify((await fn(clone(payload))) || {})) };
  } catch (err) {
    return { ok: false, error: errorShape(err) };
  }
}

// The packaged plugin probes the running user's data directories. Give it a
// private home, and hide /home so a real installation is never chosen.
function sandboxRequire(home) {
  const realFs = require("node:fs");
  const sandboxFs = Object.create(realFs);
  sandboxFs.existsSync = (p) => (p === "/home" ? false : realFs.existsSync(p));
  const sandboxOs = Object.create(os);
  sandboxOs.homedir = () => home;
  return (name) => {
    if (name === "fs") return sandboxFs;
    if (name === "os") return sandboxOs;
    if (name === "path") return path;
    throw new Error(`packaged harness does not provide module ${name}`);
  };
}

async function settle(rounds = 25) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

// startPackaged loads plugin.js once against api and waits for its bridge.
async function startPackaged(api) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sp-mcp-v20-harness-"));
  const shimRequire = sandboxRequire(home);
  const context = {
    PluginAPI: {
      ...api,
      executeNodeScript: async ({ script, args }) => {
        try {
          const fn = new Function("require", "args", script);
          return { success: true, result: fn(shimRequire, args || []) };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      },
    },
    window: {},
    console: { log: () => {}, error: () => {} },
    setTimeout: (fn) => {
      setImmediate(fn);
      return 1;
    },
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
  };
  vm.runInNewContext(fs.readFileSync(PACKAGED_PLUGIN, "utf8"), context);
  for (let i = 0; i < 50 && !context.window.mcpBridge; i++) await settle(1);
  if (!context.window.mcpBridge) throw new Error("packaged plugin did not become ready");
  const { dirs, tick } = context.window.mcpBridge;
  let seq = 0;
  return {
    dirs,
    async call(action, payload = {}) {
      const id = `req_harness_${++seq}`;
      const envelope = { protocolVersion: "2.0", id, type: "request", action, payload: clone(payload) };
      fs.writeFileSync(path.join(dirs.inbox, `${id}.json`), JSON.stringify(envelope));
      await tick();
      const out = JSON.parse(fs.readFileSync(path.join(dirs.outbox, `${id}.json`), "utf8"));
      fs.unlinkSync(path.join(dirs.outbox, `${id}.json`));
      return out.status === "ok" ? { ok: true, result: out.result } : { ok: false, error: { code: out.error.code, message: out.error.message } };
    },
    close() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

async function runPackaged(api, action, payload = {}) {
  const bridge = await startPackaged(api);
  try {
    return await bridge.call(action, payload);
  } finally {
    bridge.close();
  }
}

// runBoth runs the action through each projection with its own fresh API, so
// a write in one cannot leak into the other.
async function runBoth(action, payload = {}, overrides = {}) {
  const modular = createPluginApi(overrides);
  const packaged = createPluginApi(overrides);
  return {
    modular: { ...(await runModular(modular.api, action, payload)), calls: modular.calls, state: modular.state },
    packaged: { ...(await runPackaged(packaged.api, action, payload)), calls: packaged.calls, state: packaged.state },
  };
}

module.exports = {
  STOCK_V20_ALLOWED_ACTION_TYPES,
  createPluginApi,
  loadFixture,
  runBoth,
  runModular,
  runPackaged,
  startPackaged,
  writes,
};
