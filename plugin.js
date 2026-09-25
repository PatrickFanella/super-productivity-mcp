// Browser-safe Super Productivity MCP bridge entrypoint.
// This file intentionally avoids runtime module loading in the plugin iframe.
(function () {
  const PROTOCOL_VERSION = "2.0";
  const POLL_INTERVAL_MS = 1500;
  const MAX_RETRIES = 10;
  const INITIAL_DELAY_MS = 1000;
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;

  let dirs = null;
  let pollTimer = null;

  function typedError(code, message, retryable, details) {
    return { code, message, retryable: !!retryable, details };
  }

  function unwrapNodeResult(result) {
    if (result && result.success === false) {
      throw new Error(result.error || "Node script execution failed");
    }
    return result && result.result !== undefined ? result.result : result;
  }

  async function execScript(script, args, timeout) {
    const result = await PluginAPI.executeNodeScript({ script, args: args || [], timeout: timeout || 5000 });
    return unwrapNodeResult(result);
  }

  async function setupDirectories() {
    return execScript(
      `
        const fs = require('fs');
        const path = require('path');
        const app = 'super-productivity-mcp';
        const tmpRoot = '/tmp';
        const homeCandidates = fs.existsSync('/home')
          ? fs.readdirSync('/home').map((u) => path.join('/home', u))
          : [];
        const candidates = [];
        for (const home of homeCandidates) {
          candidates.push(path.join(home, '.local', 'share', app));
          candidates.push(path.join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'data', app));
          candidates.push(path.join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'config', app));
          candidates.push(path.join(home, 'snap', 'superproductivity', 'common', '.local', 'share', app));
          candidates.push(path.join(home, 'snap', 'superproductivity', 'current', '.local', 'share', app));
        }
        candidates.push(path.join(tmpRoot, app));

        function isTmpDataDir(dir) { return dir === tmpRoot || dir.indexOf(tmpRoot + '/') === 0; }
        function ensureWritableDir(dir) {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          const testPath = path.join(dir, '.write-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
          fs.writeFileSync(testPath, 'ok', { mode: 0o600 });
          fs.unlinkSync(testPath);
        }
        function ensureIpcDirs(baseDir) {
          ensureWritableDir(baseDir);
          const out = { base: baseDir };
          for (const d of ['inbox', 'processing', 'outbox', 'events', 'deadletter']) {
            const p = path.join(baseDir, d);
            ensureWritableDir(p);
            out[d] = p;
          }
          return out;
        }

        const errors = [];
        for (const p of candidates.filter((p) => !isTmpDataDir(p))) {
          try {
            const cfg = path.join(p, 'mcp_config.json');
            if (fs.existsSync(cfg)) {
              const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
              if (c.dataDir && fs.existsSync(c.dataDir) && !isTmpDataDir(c.dataDir)) return ensureIpcDirs(c.dataDir);
            }
          } catch (e) { errors.push(p + ' config: ' + (e.message || e)); }
        }
        for (const p of candidates) {
          try { return ensureIpcDirs(p); }
          catch (e) { errors.push(p + ': ' + (e.message || e)); }
        }
        throw new Error('No writable MCP data directory found. Tried: ' + errors.join('; '));
      `,
      [],
      10000,
    );
  }

  async function listRequestFiles(inboxDir) {
    const result = await execScript(
      `
        const fs = require('fs');
        const path = require('path');
        const dir = args[0];
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => {
            const p = path.join(dir, f);
            return { path: p, mtime: fs.statSync(p).mtimeMs };
          })
          .sort((a, b) => a.mtime - b.mtime)
          .map((x) => x.path);
      `,
      [inboxDir],
      10000,
    );
    return Array.isArray(result) ? result : [];
  }

  async function moveToProcessing(filePath) {
    return execScript(
      `
        const fs = require('fs');
        const path = require('path');
        const src = args[0];
        const dst = path.join(args[1], path.basename(src));
        fs.renameSync(src, dst);
        return dst;
      `,
      [filePath, dirs.processing],
    );
  }

  async function readEnvelope(filePath) {
    return execScript(
      `const fs = require('fs'); return JSON.parse(fs.readFileSync(args[0], 'utf8'));`,
      [filePath],
      5000,
    );
  }

  async function writeEnvelopeAtomic(dir, id, envelope) {
    return execScript(
      `
        const fs = require('fs');
        const path = require('path');
        const finalPath = path.join(args[0], args[1] + '.json');
        const tmpPath = finalPath + '.tmp.' + Date.now();
        fs.writeFileSync(tmpPath, JSON.stringify(args[2], null, 2), { mode: 0o600 });
        try { fs.unlinkSync(finalPath); } catch (e) {}
        fs.renameSync(tmpPath, finalPath);
        return finalPath;
      `,
      [dir, id, envelope],
      5000,
    );
  }

  async function removeFile(filePath) {
    return execScript(
      `const fs = require('fs'); if (fs.existsSync(args[0])) fs.unlinkSync(args[0]); return true;`,
      [filePath],
      2000,
    );
  }

  async function cleanStaleFiles() {
    return execScript(
      `
        const fs = require('fs');
        const path = require('path');
        const now = Date.now();
        for (const dir of args[0]) {
          try {
            for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
              const p = path.join(dir, f);
              if (now - fs.statSync(p).mtimeMs > args[1]) fs.unlinkSync(p);
            }
          } catch (e) {}
        }
        return true;
      `,
      [[dirs.inbox, dirs.processing, dirs.outbox, dirs.deadletter], STALE_THRESHOLD_MS],
      5000,
    );
  }

  function makeOkResponse(id, result) {
    return { protocolVersion: PROTOCOL_VERSION, id, type: 'response', status: 'ok', result: result || {}, error: null, meta: { handledAt: new Date().toISOString() } };
  }

  function makeErrResponse(id, error) {
    return { protocolVersion: PROTOCOL_VERSION, id, type: 'response', status: 'error', result: {}, error, meta: { handledAt: new Date().toISOString() } };
  }

  function validateEnvelope(env) {
    if (!env || typeof env !== 'object') return typedError('INVALID_ENVELOPE', 'Envelope must be an object', false);
    if (env.protocolVersion !== PROTOCOL_VERSION) return typedError('INCOMPATIBLE_PROTOCOL', 'Expected protocol ' + PROTOCOL_VERSION, false, { got: env.protocolVersion });
    if (env.type !== 'request') return typedError('INVALID_TYPE', 'Envelope type must be request', false, { got: env.type });
    if (!env.id || !env.action) return typedError('INVALID_REQUEST', 'Request must include id and action', false);
    return null;
  }

  function localDateStr(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  async function findTask(taskId) {
    const tasks = await PluginAPI.getTasks();
    return tasks.find((t) => t.id === taskId) || null;
  }

  async function taskCreate(payload) {
    const data = await buildTaskData(payload);
    const taskId = await PluginAPI.addTask(data);
    return { taskId };
  }

  async function buildTaskData(payload) {
    const parsed = await parseTaskShortSyntax(payload.title || '');
    const data = {
      title: parsed.title,
      notes: payload.notes || '',
      projectId: valueOf(payload, 'projectId', 'project_id') || parsed.projectId,
      parentId: valueOf(payload, 'parentId', 'parent_id'),
      timeEstimate: valueOf(payload, 'timeEstimate', 'time_estimate') ?? parsed.timeEstimate ?? 0,
      tagIds: mergeUnique(valueOf(payload, 'tagIds', 'tag_ids') || [], parsed.tagIds),
    };
    if (parsed.timeSpent != null) data.timeSpent = parsed.timeSpent;
    if (parsed.dueDay != null) data.dueDay = parsed.dueDay;
    if (parsed.dueWithTime != null) data.dueWithTime = parsed.dueWithTime;
    return data;
  }

  async function taskCreateWithSubtasks(payload) {
    if (!Array.isArray(payload && payload.subtasks)) throw typedError('INVALID_REQUEST', 'subtasks must be an array', false);
    const parentData = await buildTaskData(payload);
    const parentId = await PluginAPI.addTask(parentData);
    const subtaskIds = [];
    for (const subtask of payload.subtasks) {
      const childData = await buildTaskData(Object.assign({}, subtask, { parentId }));
      subtaskIds.push(await PluginAPI.addTask(childData));
    }
    return { parentId, subtaskIds };
  }

  async function parseTaskShortSyntax(title) {
    const parsed = { title: title || '', tagIds: [] };
    const remove = [];
    for (const match of title.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
      const tag = await findTagByTitle(match[1]);
      if (tag && tag.id) parsed.tagIds.push(tag.id);
      remove.push(match[0]);
    }
    for (const match of title.matchAll(/\+([\p{L}\p{N}_-]{3,})/gu)) {
      const project = await findProjectByPrefix(match[1]);
      if (project && project.id && !parsed.projectId) parsed.projectId = project.id;
      remove.push(match[0]);
    }
    const due = parseDueSyntax(title);
    if (due) {
      parsed.dueDay = due.dueDay;
      if (due.dueWithTime != null) parsed.dueWithTime = due.dueWithTime;
      remove.push(due.token);
      if (due.timeToken) remove.push(due.timeToken);
    }
    const estimate = parseTimeSyntax(title);
    if (estimate) {
      if (estimate.timeSpent != null) parsed.timeSpent = estimate.timeSpent;
      if (estimate.timeEstimate != null) parsed.timeEstimate = estimate.timeEstimate;
      remove.push(estimate.token);
    }
    parsed.title = stripTokens(title, remove) || title;
    return parsed;
  }

  async function findTagByTitle(title) {
    if (typeof PluginAPI.getAllTags !== 'function') return null;
    const tags = await PluginAPI.getAllTags();
    const needle = title.toLowerCase();
    return tags.find((tag) => String(tag.title || tag.name || '').toLowerCase() === needle) || null;
  }

  async function findProjectByPrefix(prefix) {
    if (typeof PluginAPI.getAllProjects !== 'function') return null;
    const projects = await PluginAPI.getAllProjects();
    const needle = prefix.toLowerCase();
    return projects.find((project) => String(project.title || project.name || '').toLowerCase().startsWith(needle)) || null;
  }

  function parseDueSyntax(title) {
    const match = title.match(/@(today|tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s+((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?|(?:1[0-2]|0?\d)\s*(?:am|pm)))?/i);
    if (!match) return null;
    const date = resolveDueDate(match[1]);
    const out = { token: match[0], dueDay: localDateStr(date), timeToken: match[2] };
    const time = parseClockTime(match[2]);
    if (time) out.dueWithTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute).getTime();
    return out;
  }

  function resolveDueDate(word) {
    const normalized = word.toLowerCase().slice(0, 3);
    const date = new Date();
    if (normalized === 'tom') { date.setDate(date.getDate() + 1); return date; }
    if (normalized === 'tod') return date;
    const weekdays = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    if (weekdays[normalized] !== undefined) {
      let diff = weekdays[normalized] - date.getDay();
      if (diff <= 0) diff += 7;
      date.setDate(date.getDate() + diff);
    }
    return date;
  }

  function parseClockTime(raw) {
    if (!raw) return null;
    const match = String(raw).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridian = match[3] && match[3].toLowerCase();
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }

  function parseTimeSyntax(title) {
    const match = title.match(/\b(\d+(?:\.\d+)?)([hm])(?:\/(\d+(?:\.\d+)?)([hm]))?\b/i);
    if (!match) return null;
    const first = durationMs(match[1], match[2]);
    const second = match[3] ? durationMs(match[3], match[4]) : null;
    return second == null ? { token: match[0], timeEstimate: first } : { token: match[0], timeSpent: first, timeEstimate: second };
  }

  function durationMs(amount, unit) {
    const multiplier = unit.toLowerCase() === 'h' ? 60 * 60 * 1000 : 60 * 1000;
    return Math.round(Number(amount) * multiplier);
  }

  function stripTokens(title, tokens) {
    let out = title;
    for (const token of tokens.filter(Boolean).sort((a, b) => b.length - a.length)) out = out.replace(token, ' ');
    return out.replace(/\s+/g, ' ').trim();
  }

  async function taskList(payload) {
    payload = payload || {};
    let tasks = await getTasksBySource(payload.source || 'active');
    if (payload.includeDone === false) tasks = tasks.filter((t) => !t.isDone);
    const projectId = valueOf(payload, 'projectId', 'project_id');
    if (projectId) tasks = tasks.filter((t) => t.projectId === projectId);
    const tagId = valueOf(payload, 'tagId', 'tag_id');
    if (tagId) tasks = tasks.filter((t) => Array.isArray(t.tagIds) && t.tagIds.includes(tagId));
    const isDone = valueOf(payload, 'isDone', 'is_done');
    if (typeof isDone === 'boolean') tasks = tasks.filter((t) => !!t.isDone === isDone);
    const isArchived = valueOf(payload, 'isArchived', 'is_archived');
    if (typeof isArchived === 'boolean') tasks = tasks.filter((t) => !!t.isArchived === isArchived);
    const search = String(payload.search || '').trim().toLowerCase();
    if (search) tasks = tasks.filter((t) => ((t.title || '') + '\n' + (t.notes || '')).toLowerCase().includes(search));
    if (valueOf(payload, 'parentsOnly', 'parents_only')) tasks = tasks.filter((t) => !t.parentId);
    if (payload.overdue) {
      const today = localDateStr(new Date());
      tasks = tasks.filter((t) => t.dueDay != null && t.dueDay < today);
    }
    if (payload.unscheduled) tasks = tasks.filter((t) => !t.dueDay && !t.dueWithTime);
    if (payload.plannedForToday) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const end = start + 86400000;
      tasks = tasks.filter((t) => t.plannedAt != null && t.plannedAt >= start && t.plannedAt < end);
    }
    if (valueOf(payload, 'recurringOnly', 'recurring_only')) tasks = tasks.filter((t) => !!(t.repeatCfgId || t.recurrenceRule || t.repeatCycle));
    if (valueOf(payload, 'includeSynthetic', 'include_synthetic')) tasks = await withSyntheticTaskFields(tasks);
    tasks = sortAndPageTasks(tasks, payload);
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    if (fields.length > 0) tasks = tasks.map((task) => pickFields(task, fields));
    return { tasks };
  }

  async function taskArchivedList(payload) {
    if (typeof PluginAPI.getArchivedTasks !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.getArchivedTasks is not available in this Super Productivity runtime', false);
    return taskList(Object.assign({}, payload || {}, { source: 'archived' }));
  }

  async function taskCurrentContextList(payload) {
    if (typeof PluginAPI.getCurrentContextTasks !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.getCurrentContextTasks is not available in this Super Productivity runtime', false);
    payload = payload || {};
    let tasks = (await PluginAPI.getCurrentContextTasks()).map((task) => Object.assign({ isArchived: false }, task, { isArchived: task.isArchived == null ? false : task.isArchived }));
    if (payload.includeDone === false) tasks = tasks.filter((task) => !task.isDone);
    if (valueOf(payload, 'includeSynthetic', 'include_synthetic')) tasks = await withSyntheticTaskFields(tasks);
    tasks = sortAndPageTasks(tasks, payload);
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    if (fields.length > 0) tasks = tasks.map((task) => pickFields(task, fields));
    return { tasks };
  }

  async function getTasksBySource(source) {
    const normalized = ['active', 'archived', 'all'].includes(source) ? source : 'active';
    const active = (await PluginAPI.getTasks()).map((task) => Object.assign({ isArchived: false }, task, { isArchived: task.isArchived == null ? false : task.isArchived }));
    if (normalized === 'active') return active;
    if (typeof PluginAPI.getArchivedTasks !== 'function') return normalized === 'archived' ? [] : active;
    const archived = (await PluginAPI.getArchivedTasks()).map((task) => Object.assign({}, task, { isArchived: true }));
    return normalized === 'archived' ? archived : active.concat(archived);
  }

  async function withSyntheticTaskFields(tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const projects = typeof PluginAPI.getAllProjects === 'function' ? await PluginAPI.getAllProjects() : [];
    const projectById = new Map(projects.map((project) => [project.id, project]));
    return tasks.map((task) => Object.assign({}, task, {
      noteLength: String(task.notes || '').length,
      subtaskCount: Array.isArray(task.subTaskIds) ? task.subTaskIds.length : tasks.filter((candidate) => candidate.parentId === task.id).length,
      isRecurring: !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle),
      parentTitle: task.parentId ? (byId.get(task.parentId) || {}).title : undefined,
      projectTitle: task.projectId ? (projectById.get(task.projectId) || {}).title || (projectById.get(task.projectId) || {}).name : undefined,
    }));
  }

  function sortAndPageTasks(tasks, payload) {
    const sortBy = valueOf(payload || {}, 'sortBy', 'sort_by');
    let out = tasks.slice();
    if (['title', 'created', 'updated', 'dueDay', 'plannedAt', 'timeEstimate'].includes(sortBy)) {
      const direction = valueOf(payload || {}, 'sortDirection', 'sort_direction') === 'desc' ? -1 : 1;
      out.sort((a, b) => compareTaskField(a, b, sortBy) * direction);
    }
    const offset = Math.max(0, Number(valueOf(payload || {}, 'offset', 'offset') || 0));
    const limitValue = valueOf(payload || {}, 'limit', 'limit');
    if (offset > 0) out = out.slice(offset);
    if (limitValue != null) out = out.slice(0, Math.max(0, Number(limitValue)));
    return out;
  }

  function compareTaskField(a, b, field) {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return String(a.title || '').localeCompare(String(b.title || ''));
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' || typeof bv === 'number') return Number(av) - Number(bv);
    return String(av).localeCompare(String(bv)) || String(a.title || '').localeCompare(String(b.title || ''));
  }

  function valueOf(obj, camelName, snakeName) {
    if (obj[camelName] !== undefined) return obj[camelName];
    return obj[snakeName];
  }

  function pickFields(task, fields) {
    const out = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(task, field)) out[field] = task[field];
    }
    return out;
  }

  function mergeUnique(first, second) {
    return Array.from(new Set([...(first || []), ...(second || [])]));
  }

  async function taskGet(payload) {
    const task = await findTask(payload.taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + payload.taskId + ' not found', false);
    return { task };
  }

  async function taskUpdate(payload) {
    if (!payload.taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const updates = Object.assign({}, payload);
    delete updates.taskId;
    await PluginAPI.updateTask(payload.taskId, updates);
    return { updated: true };
  }

  const ADD_REPEAT_CFG_TO_TASK = '[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task';
  const UPDATE_REPEAT_CFG = '[TaskRepeatCfg] Update TaskRepeatCfg';
  const DELETE_REPEAT_CFG = '[Task Shared] deleteTaskRepeatCfg';
  const REPEAT_CYCLES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
  const QUICK_SETTINGS = new Set([
    'DAILY',
    'WEEKLY_CURRENT_WEEKDAY',
    'MONTHLY_CURRENT_DATE',
    'MONTHLY_FIRST_DAY',
    'MONTHLY_LAST_DAY',
    'MONTHLY_NTH_WEEKDAY',
    'MONDAY_TO_FRIDAY',
    'YEARLY_CURRENT_DATE',
    'CUSTOM',
  ]);
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  function newRepeatCfgId() {
    return 'mcp_repeat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function persistenceMeta(entityId, opType) {
    return { isPersistent: true, entityType: 'TASK_REPEAT_CFG', entityId, opType };
  }

  function assertDispatchActionAvailable() {
    if (typeof PluginAPI.dispatchAction !== 'function') {
      throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.dispatchAction is required for recurrence tools', false);
    }
  }

  function normalizeRepeatCycle(value) {
    if (!REPEAT_CYCLES.has(value)) {
      throw typedError('INVALID_REQUEST', 'repeatCycle must be one of ' + Array.from(REPEAT_CYCLES).join(', '), false);
    }
    return value;
  }

  function normalizeQuickSetting(value, repeatCycle) {
    if (value == null) return repeatCycle === 'DAILY' ? 'DAILY' : 'CUSTOM';
    if (!QUICK_SETTINGS.has(value)) {
      throw typedError('INVALID_REQUEST', 'quickSetting must be one of ' + Array.from(QUICK_SETTINGS).join(', '), false);
    }
    return value;
  }

  function normalizeRepeatEvery(value) {
    const n = Number(value == null ? 1 : value);
    if (!Number.isInteger(n) || n < 1) {
      throw typedError('INVALID_REQUEST', 'repeatEvery must be an integer >= 1', false);
    }
    return n;
  }

  function normalizeTime(value) {
    if (value == null || value === '') return undefined;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw typedError('INVALID_REQUEST', 'startTime must be HH:MM', false);
    }
    return value;
  }

  function normalizeDate(value) {
    if (value == null || value === '') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw typedError('INVALID_REQUEST', 'startDate must be YYYY-MM-DD', false);
    }
    return value;
  }

  function normalizeSubTaskTemplates(value) {
    if (value == null) return undefined;
    if (!Array.isArray(value)) throw typedError('INVALID_REQUEST', 'subTaskTemplates must be an array', false);
    return value.map((item) => {
      if (!item || typeof item.title !== 'string' || item.title.trim() === '') {
        throw typedError('INVALID_REQUEST', 'each subTaskTemplate requires title', false);
      }
      const out = { title: item.title };
      const estimate = valueOf(item, 'timeEstimate', 'time_estimate');
      if (estimate != null) out.timeEstimate = Number(estimate);
      if (item.notes != null) out.notes = item.notes;
      return out;
    });
  }

  function setIfPresent(out, input, camelName, snakeName, normalize) {
    const value = valueOf(input, camelName, snakeName);
    if (value !== undefined) out[camelName] = normalize ? normalize(value) : value;
  }

  function normalizeRepeatCfgForCreate(input, task) {
    const repeatCycle = normalizeRepeatCycle(valueOf(input, 'repeatCycle', 'repeat_cycle'));
    const quickSetting = normalizeQuickSetting(valueOf(input, 'quickSetting', 'quick_setting'), repeatCycle);
    const repeatEvery = normalizeRepeatEvery(valueOf(input, 'repeatEvery', 'repeat_every'));
    const today = localDateStr(new Date());
    const cfg = {
      id: newRepeatCfgId(),
      projectId: valueOf(input, 'projectId', 'project_id') ?? task.projectId ?? null,
      lastTaskCreation: Date.now(),
      lastTaskCreationDay: today,
      title: input.title ?? task.title ?? null,
      tagIds: valueOf(input, 'tagIds', 'tag_ids') ?? task.tagIds ?? [],
      order: 0,
      defaultEstimate: valueOf(input, 'defaultEstimate', 'default_estimate'),
      startTime: normalizeTime(valueOf(input, 'startTime', 'start_time')),
      startDate: normalizeDate(valueOf(input, 'startDate', 'start_date')),
      repeatEvery,
      isPaused: valueOf(input, 'isPaused', 'is_paused') === true,
      quickSetting,
      repeatCycle,
      repeatFromCompletionDate: valueOf(input, 'repeatFromCompletionDate', 'repeat_from_completion_date') === true,
      waitForCompletion: valueOf(input, 'waitForCompletion', 'wait_for_completion') === true,
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      notes: input.notes ?? task.notes,
      shouldInheritSubtasks: valueOf(input, 'shouldInheritSubtasks', 'should_inherit_subtasks') === true,
      disableAutoUpdateSubtasks: valueOf(input, 'disableAutoUpdateSubtasks', 'disable_auto_update_subtasks') === true,
      skipOverdue: valueOf(input, 'skipOverdue', 'skip_overdue') === true,
    };
    for (const day of WEEKDAYS) cfg[day] = input[day] === true;
    if (repeatCycle === 'DAILY') cfg.monday = cfg.tuesday = cfg.wednesday = cfg.thursday = cfg.friday = cfg.saturday = cfg.sunday = true;
    if (quickSetting === 'MONDAY_TO_FRIDAY') cfg.monday = cfg.tuesday = cfg.wednesday = cfg.thursday = cfg.friday = true;
    const templates = normalizeSubTaskTemplates(input.subTaskTemplates || input.sub_task_templates);
    if (templates) cfg.subTaskTemplates = templates;
    return cfg;
  }

  function normalizeRepeatCfgChanges(input) {
    const changes = {};
    setIfPresent(changes, input, 'repeatCycle', 'repeat_cycle', normalizeRepeatCycle);
    setIfPresent(changes, input, 'quickSetting', 'quick_setting', (value) => normalizeQuickSetting(value, changes.repeatCycle || 'WEEKLY'));
    setIfPresent(changes, input, 'repeatEvery', 'repeat_every', normalizeRepeatEvery);
    setIfPresent(changes, input, 'startTime', 'start_time', normalizeTime);
    setIfPresent(changes, input, 'startDate', 'start_date', normalizeDate);
    setIfPresent(changes, input, 'isPaused', 'is_paused');
    setIfPresent(changes, input, 'waitForCompletion', 'wait_for_completion');
    setIfPresent(changes, input, 'skipOverdue', 'skip_overdue');
    setIfPresent(changes, input, 'repeatFromCompletionDate', 'repeat_from_completion_date');
    setIfPresent(changes, input, 'defaultEstimate', 'default_estimate');
    setIfPresent(changes, input, 'title', 'title');
    setIfPresent(changes, input, 'notes', 'notes');
    setIfPresent(changes, input, 'tagIds', 'tag_ids');
    setIfPresent(changes, input, 'projectId', 'project_id');
    for (const day of WEEKDAYS) setIfPresent(changes, input, day, day);
    if (Object.keys(changes).length === 0) throw typedError('NO_UPDATE_FIELDS', 'No recurrence changes provided', false);
    return changes;
  }

  async function taskSetRecurrence(payload) {
    assertDispatchActionAvailable();
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (task.repeatCfgId) throw typedError('TASK_ALREADY_RECURRING', 'Task ' + taskId + ' already has repeatCfgId ' + task.repeatCfgId, false);
    const recurrence = payload.recurrence || {};
    const taskRepeatCfg = normalizeRepeatCfgForCreate(recurrence, task);
    await PluginAPI.dispatchAction({
      type: ADD_REPEAT_CFG_TO_TASK,
      taskId,
      taskRepeatCfg,
      startTime: taskRepeatCfg.startTime,
      remindAt: taskRepeatCfg.remindAt,
      meta: persistenceMeta(taskRepeatCfg.id, 'CRT'),
    });
    return { repeatCfgId: taskRepeatCfg.id, created: true };
  }

  async function taskUpdateRecurrence(payload) {
    assertDispatchActionAvailable();
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (!task.repeatCfgId) throw typedError('TASK_NOT_RECURRING', 'Task ' + taskId + ' has no repeatCfgId', false);
    const changes = normalizeRepeatCfgChanges(payload.changes || {});
    await PluginAPI.dispatchAction({
      type: UPDATE_REPEAT_CFG,
      taskRepeatCfg: { id: task.repeatCfgId, changes },
      isAskToUpdateAllTaskInstances: valueOf(payload || {}, 'isAskToUpdateAllTaskInstances', 'is_ask_to_update_all_task_instances') === true,
      meta: persistenceMeta(task.repeatCfgId, 'UPD'),
    });
    return { repeatCfgId: task.repeatCfgId, updated: true };
  }

  async function taskDeleteRecurrence(payload) {
    assertDispatchActionAvailable();
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (!task.repeatCfgId) throw typedError('TASK_NOT_RECURRING', 'Task ' + taskId + ' has no repeatCfgId', false);
    await PluginAPI.dispatchAction({
      type: DELETE_REPEAT_CFG,
      taskRepeatCfgId: task.repeatCfgId,
      meta: persistenceMeta(task.repeatCfgId, 'DEL'),
    });
    return { repeatCfgId: task.repeatCfgId, deleted: true };
  }

  const ADD_ISSUE_PROVIDER = '[IssueProvider/API] Add IssueProvider';
  const GITEA_SCOPES = ['all', 'created-by-me', 'assigned-to-me'];

  async function readGiteaTokenFile(tokenFile) {
    if (typeof tokenFile !== 'string' || !tokenFile.startsWith('/')) throw typedError('INVALID_REQUEST', 'tokenFile must be an absolute path', false);
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
    if (result && result.success === false) throw typedError('TOKEN_FILE_UNREADABLE', 'Could not read tokenFile', false);
    const out = result && result.result !== undefined ? result.result : result;
    if (out && out.error === 'TOKEN_FILE_PERMISSIONS') throw typedError('TOKEN_FILE_PERMISSIONS', 'tokenFile must not be readable by group or others (chmod 600)', false);
    if (!out || out.error === 'TOKEN_FILE_EMPTY' || !out.token) throw typedError('TOKEN_FILE_EMPTY', 'tokenFile is empty', false);
    return out.token;
  }

  async function issueProviderCreateGitea(payload) {
    if (typeof PluginAPI.dispatchAction !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.dispatchAction is required for issue provider tools', false);
    const input = payload || {};
    const projectId = valueOf(input, 'projectId', 'project_id');
    if (!projectId) throw typedError('INVALID_REQUEST', 'projectId is required', false);
    const projects = await PluginAPI.getAllProjects();
    if (!projects.some((p) => p.id === projectId)) throw typedError('PROJECT_NOT_FOUND', 'Project ' + projectId + ' not found', false);
    if (typeof input.host !== 'string' || !/^https?:\/\/[^\s/]+/.test(input.host)) throw typedError('INVALID_REQUEST', 'host must be an http(s) URL', false);
    const host = input.host.replace(/\/+$/, '');
    const repoFullname = valueOf(input, 'repoFullname', 'repo_full_name');
    if (typeof repoFullname !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repoFullname)) throw typedError('INVALID_REQUEST', 'repoFullname must look like owner/repo', false);
    const scope = input.scope == null ? 'all' : input.scope;
    if (!GITEA_SCOPES.includes(scope)) throw typedError('INVALID_REQUEST', 'scope must be one of ' + GITEA_SCOPES.join(', '), false);
    const token = await readGiteaTokenFile(valueOf(input, 'tokenFile', 'token_file'));
    const autoPoll = valueOf(input, 'isAutoPoll', 'is_auto_poll');
    const autoAdd = valueOf(input, 'isAutoAddToBacklog', 'is_auto_add_to_backlog');
    const id = 'mcp_gitea_' + projectId;
    const issueProvider = {
      id,
      isEnabled: true,
      issueProviderKey: 'GITEA',
      isAutoPoll: autoPoll == null ? true : autoPoll === true,
      isAutoAddToBacklog: autoAdd === true,
      isIntegratedAddTaskBar: false,
      defaultProjectId: projectId,
      pinnedSearch: null,
      pollingMode: 'whenProjectOpen',
      defaultTagIds: [],
      defaultNote: null,
      pluginId: 'gitea-issue-provider',
      pluginConfig: {
        host,
        token,
        repoFullname,
        scope,
        filterLabels: valueOf(input, 'filterLabels', 'filter_labels') || '',
        excludeLabels: valueOf(input, 'excludeLabels', 'exclude_labels') || '',
      },
    };
    await PluginAPI.dispatchAction({
      type: ADD_ISSUE_PROVIDER,
      issueProvider,
      meta: { isPersistent: true, entityType: 'ISSUE_PROVIDER', entityId: id, opType: 'CRT' },
    });
    return { issueProviderId: id, projectId, repoFullname, scope, created: true };
  }

  async function taskComplete(payload) { await PluginAPI.updateTask(payload.taskId, { isDone: true, doneOn: Date.now() }); return { completed: true }; }
  async function taskUncomplete(payload) { await PluginAPI.updateTask(payload.taskId, { isDone: false, doneOn: null }); return { uncompleted: true }; }
  async function taskArchive(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (valueOf(payload || {}, 'allowDoneFallback', 'allow_done_fallback') === true) {
      await PluginAPI.updateTask(taskId, { isDone: true, doneOn: Date.now() });
      return { archived: false, note: 'True archive unavailable in browser plugin; explicit allowDoneFallback marked task done instead' };
    }
    throw typedError('UNSUPPORTED_ACTION', 'True archive requires the modular bridge with SP_LOCAL_REST_URL or SUPER_PRODUCTIVITY_REST_URL. Pass allowDoneFallback:true only if marking done is acceptable.', false);
  }
  async function taskAddTime(payload) {
    const task = await findTask(payload.taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + payload.taskId + ' not found', false);
    const timeSpent = (task.timeSpent || 0) + Number(payload.timeMs || 0);
    await PluginAPI.updateTask(payload.taskId, { timeSpent });
    return { timeSpent };
  }
  async function taskDelete(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (typeof PluginAPI.deleteTask !== 'function') throw typedError('UNSUPPORTED_ACTION', 'deleteTask not supported by this plugin runtime', false);
    await PluginAPI.deleteTask(taskId);
    return { deleted: true };
  }
  async function taskRestore(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    throw typedError('UNSUPPORTED_ACTION', 'Restore requires the modular bridge with SP_LOCAL_REST_URL or SUPER_PRODUCTIVITY_REST_URL.', false);
  }
  async function taskReorder(payload) {
    if (typeof PluginAPI.reorderTasks !== 'function') return { reordered: false, note: 'reorderTasks not supported by this plugin runtime' };
    const taskIds = valueOf(payload || {}, 'taskIds', 'task_ids') || [];
    const contextId = valueOf(payload || {}, 'contextId', 'context_id');
    const contextType = valueOf(payload || {}, 'contextType', 'context_type') || 'project';
    await validateReorderContext(taskIds, contextId, contextType);
    const apiContextType = contextType === 'parent' ? 'task' : contextType;
    await PluginAPI.reorderTasks(taskIds, contextId, apiContextType);
    return { reordered: true };
  }

  async function validateReorderContext(taskIds, contextId, contextType) {
    if (!contextId || taskIds.length === 0) return;
    const tasks = await PluginAPI.getTasks();
    for (const taskId of taskIds) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
      let belongs = false;
      if (contextType === 'parent') belongs = task.parentId === contextId;
      else if (contextType === 'tag') belongs = Array.isArray(task.tagIds) && task.tagIds.includes(contextId);
      else belongs = task.projectId === contextId;
      if (!belongs) throw typedError('TASK_CONTEXT_MISMATCH', 'Task ' + taskId + ' does not belong to context ' + contextId, false, { taskId, contextId, contextType });
    }
  }

  async function taskStart(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    const tasks = await PluginAPI.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (task.isDone) throw typedError('TASK_DONE', 'Cannot start completed task ' + taskId, false);
    const active = tasks.find((t) => t.currentTimestamp > 0 && t.id !== taskId);
    if (active) await PluginAPI.updateTask(active.id, { currentTimestamp: null });
    await PluginAPI.updateTask(taskId, { currentTimestamp: Date.now() });
    return { started: true };
  }

  async function taskStop() {
    const tasks = await PluginAPI.getTasks();
    const active = tasks.find((t) => t.currentTimestamp > 0);
    if (!active) return { stopped: false };
    await PluginAPI.updateTask(active.id, { currentTimestamp: null });
    return { stopped: true };
  }

  async function taskCurrent() {
    const tasks = await PluginAPI.getTasks();
    const active = tasks.find((t) => t.currentTimestamp > 0);
    if (!active) return { task: null };
    return { task: { id: active.id, title: active.title, isDone: active.isDone, projectId: active.projectId, parentId: active.parentId, tagIds: active.tagIds, dueDay: active.dueDay } };
  }

  async function taskBulkComplete(payload) {
    const taskIds = valueOf(payload || {}, 'taskIds', 'task_ids') || [];
    const tasks = await PluginAPI.getTasks();
    const results = [];
    for (const id of taskIds) {
      if (!tasks.find((t) => t.id === id)) { results.push({ id, success: false, error: 'Task not found: ' + id }); continue; }
      try { await PluginAPI.updateTask(id, { isDone: true, doneOn: Date.now() }); results.push({ id, success: true }); }
      catch (err) { results.push({ id, success: false, error: err.message || String(err) }); }
    }
    return { results };
  }

  async function taskBulkUpdate(payload) {
    return taskBulkUpdateCore(payload || {}, null);
  }

  async function taskBulkUpdateCore(payload, allowedFields) {
    const updates = (payload && payload.updates) || [];
    const dryRun = valueOf(payload || {}, 'dryRun', 'dry_run') === true;
    const existingTasks = dryRun || allowedFields ? await getTasksBySource('all') : [];
    const results = [];
    for (const item of updates) {
      const taskId = valueOf(item, 'taskId', 'task_id');
      try {
        if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
        const fullPatch = mapTaskUpdate(item);
        const patch = pickAllowedPatch(fullPatch, allowedFields);
        if (Object.keys(patch).length === 0) throw typedError('NO_UPDATE_FIELDS', allowedFields ? 'No allowed fields provided: ' + allowedFields.join(', ') : 'No update fields provided', false);
        const task = existingTasks.find((t) => t.id === taskId) || null;
        if ((dryRun || allowedFields) && !task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
        const result = { id: taskId, success: true };
        const changes = diffTaskPatch(task, patch);
        if (changes.length) result.changes = changes;
        const ignoredFields = ignoredPatchFields(fullPatch, patch);
        if (ignoredFields.length) result.ignoredFields = ignoredFields;
        if (!dryRun) await PluginAPI.updateTask(taskId, patch);
        results.push(result);
      }
      catch (err) { results.push({ id: taskId, success: false, error: err.message || String(err) }); }
    }
    return { dryRun, results };
  }

  function pickAllowedPatch(patch, allowedFields) {
    if (!allowedFields) return patch;
    const allowed = new Set(allowedFields);
    return Object.fromEntries(Object.entries(patch).filter((pair) => allowed.has(pair[0])));
  }
  function ignoredPatchFields(fullPatch, patch) {
    const included = new Set(Object.keys(patch));
    return Object.keys(fullPatch).filter((field) => !included.has(field));
  }
  function diffTaskPatch(task, patch) {
    return Object.entries(patch).map((pair) => ({ field: pair[0], before: task ? task[pair[0]] : undefined, after: pair[1] }));
  }
  async function taskBulkReschedule(payload) { return taskBulkUpdateCore(payload || {}, ['plannedAt', 'dueDay', 'timeEstimate']); }

  async function taskClearScheduleForDay(payload) {
    payload = payload || {};
    const date = payload.date;
    if (!isLocalDateString(date)) throw typedError('INVALID_REQUEST', 'date must be YYYY-MM-DD', false);
    const includeDone = valueOf(payload, 'includeDone', 'include_done') === true;
    const includeArchived = valueOf(payload, 'includeArchived', 'include_archived') === true;
    const clearDueDay = valueOf(payload, 'clearDueDay', 'clear_due_day') === true;
    const range = dayRangeMs(date);
    const tasks = await getTasksBySource(includeArchived ? 'all' : 'active');
    const updates = [];
    for (const task of tasks) {
      if (!includeDone && task.isDone) continue;
      if (!includeArchived && task.isArchived) continue;
      const patch = {};
      if (task.plannedAt != null && task.plannedAt >= range[0] && task.plannedAt < range[1]) patch.plannedAt = null;
      if (clearDueDay && task.dueDay === date) patch.dueDay = null;
      if (Object.keys(patch).length > 0) updates.push(Object.assign({ taskId: task.id }, patch));
    }
    const out = await taskBulkUpdateCore(Object.assign({}, payload, { updates }), ['plannedAt', 'dueDay']);
    return Object.assign({}, out, { date, changedCount: out.results.filter((result) => result.success).length });
  }

  async function taskScheduleHealth(payload) {
    payload = payload || {};
    const date = payload.date || localDateStr(new Date());
    if (!isLocalDateString(date)) throw typedError('INVALID_REQUEST', 'date must be YYYY-MM-DD', false);
    const staleBeforeDate = valueOf(payload, 'staleBeforeDate', 'stale_before_date') || date;
    if (!isLocalDateString(staleBeforeDate)) throw typedError('INVALID_REQUEST', 'staleBeforeDate must be YYYY-MM-DD', false);
    const includeDone = valueOf(payload, 'includeDone', 'include_done') === true;
    const includeArchived = valueOf(payload, 'includeArchived', 'include_archived') === true;
    const oversizedNotesThreshold = Number(valueOf(payload, 'oversizedNotesThreshold', 'oversized_notes_threshold') == null ? 4000 : valueOf(payload, 'oversizedNotesThreshold', 'oversized_notes_threshold'));
    const range = dayRangeMs(date);
    const staleRange = dayRangeMs(staleBeforeDate);
    const tasks = (await getTasksBySource(includeArchived ? 'all' : 'active')).filter((task) => (includeDone || !task.isDone) && (includeArchived || !task.isArchived));
    const lists = {
      plannedToday: tasks.filter((task) => task.plannedAt != null && task.plannedAt >= range[0] && task.plannedAt < range[1]),
      overdue: tasks.filter((task) => task.dueDay != null && task.dueDay < date),
      unscheduledActiveTopLevel: tasks.filter((task) => !task.parentId && !task.plannedAt && !task.dueDay),
      stalePlanned: tasks.filter((task) => task.plannedAt != null && task.plannedAt < staleRange[0]),
      staleDue: tasks.filter((task) => task.dueDay != null && task.dueDay < staleBeforeDate),
      missingEstimate: tasks.filter((task) => !Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) <= 0),
      oversizedNotes: tasks.filter((task) => String(task.notes || '').length > oversizedNotesThreshold),
      recurringGenerated: tasks.filter((task) => !!(task.repeatCfgId || task.recurrenceRule || task.repeatCycle)),
      suspiciousDatesOrEstimates: tasks.filter(hasSuspiciousDatesOrEstimates),
    };
    const compactLists = Object.fromEntries(Object.entries(lists).map((pair) => [pair[0], pair[1].map(compactTaskSummary)]));
    const counts = Object.fromEntries(Object.entries(compactLists).map((pair) => [pair[0], pair[1].length]));
    return { date, staleBeforeDate, counts, tasks: compactLists };
  }

  async function taskScheduleRange(payload) {
    payload = payload || {};
    const startDate = valueOf(payload, 'startDate', 'start_date');
    const endDate = valueOf(payload, 'endDate', 'end_date') || startDate;
    if (!isLocalDateString(startDate)) throw typedError('INVALID_REQUEST', 'startDate must be YYYY-MM-DD', false);
    if (!isLocalDateString(endDate)) throw typedError('INVALID_REQUEST', 'endDate must be YYYY-MM-DD', false);
    const includeDone = valueOf(payload, 'includeDone', 'include_done') === true;
    const includeArchived = valueOf(payload, 'includeArchived', 'include_archived') === true;
    const startMs = dayRangeMs(startDate)[0];
    const endMs = dayRangeMs(endDate)[1];
    const tasks = (await getTasksBySource(includeArchived ? 'all' : 'active'))
      .filter((task) => (includeDone || !task.isDone) && (includeArchived || !task.isArchived))
      .filter((task) => task.plannedAt != null && task.plannedAt >= startMs && task.plannedAt < endMs)
      .sort((a, b) => Number(a.plannedAt || 0) - Number(b.plannedAt || 0) || String(a.title || '').localeCompare(String(b.title || '')));
    const byDate = new Map(localDateRange(startDate, endDate).map((date) => [date, []]));
    for (const task of tasks) {
      const date = localDateStr(new Date(task.plannedAt));
      if (byDate.has(date)) byDate.get(date).push(compactTaskSummary(task));
    }
    return { startDate, endDate, days: Array.from(byDate.entries()).map((pair) => ({ date: pair[0], tasks: pair[1] })) };
  }

  async function taskFindStaleSchedule(payload) {
    payload = payload || {};
    const beforeDate = valueOf(payload, 'beforeDate', 'before_date');
    if (!isLocalDateString(beforeDate)) throw typedError('INVALID_REQUEST', 'beforeDate must be YYYY-MM-DD', false);
    const includeDueDay = valueOf(payload, 'includeDueDay', 'include_due_day') !== false;
    const includePlannedAt = valueOf(payload, 'includePlannedAt', 'include_planned_at') !== false;
    const includeCompleted = valueOf(payload, 'includeCompleted', 'include_completed') === true;
    const includeArchived = valueOf(payload, 'includeArchived', 'include_archived') === true;
    const beforeMs = dayRangeMs(beforeDate)[0];
    const tasks = (await getTasksBySource(includeArchived ? 'all' : 'active'))
      .filter((task) => (includeCompleted || !task.isDone) && (includeArchived || !task.isArchived))
      .map((task) => ({ task, staleDueDay: includeDueDay && task.dueDay != null && task.dueDay < beforeDate, stalePlannedAt: includePlannedAt && task.plannedAt != null && task.plannedAt < beforeMs }))
      .filter((entry) => entry.staleDueDay || entry.stalePlannedAt)
      .map((entry) => Object.assign(compactTaskSummary(entry.task), { staleDueDay: entry.staleDueDay, stalePlannedAt: entry.stalePlannedAt }));
    return { beforeDate, tasks };
  }

  async function taskFindUnscheduledActive(payload) {
    payload = payload || {};
    const topLevelOnly = valueOf(payload, 'topLevelOnly', 'top_level_only') !== false;
    const missingEstimateOnly = valueOf(payload, 'missingEstimateOnly', 'missing_estimate_only') === true;
    const missingDueDateOnly = valueOf(payload, 'missingDueDateOnly', 'missing_due_date_only') === true;
    const includeProjectIds = valueOf(payload, 'includeProjectIds', 'include_project_ids') || [];
    const excludeProjectIds = valueOf(payload, 'excludeProjectIds', 'exclude_project_ids') || [];
    const includeTagIds = valueOf(payload, 'includeTagIds', 'include_tag_ids') || [];
    const excludeTagIds = valueOf(payload, 'excludeTagIds', 'exclude_tag_ids') || [];
    const tasks = (await getTasksBySource('active'))
      .filter((task) => !task.isDone && !task.isArchived)
      .filter((task) => task.plannedAt == null && task.dueDay == null)
      .filter((task) => !topLevelOnly || !task.parentId)
      .filter((task) => !missingEstimateOnly || !Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) <= 0)
      .filter((task) => !missingDueDateOnly || !task.dueDay)
      .filter((task) => includeProjectIds.length === 0 || includeProjectIds.includes(task.projectId))
      .filter((task) => excludeProjectIds.length === 0 || !excludeProjectIds.includes(task.projectId))
      .filter((task) => includeTagIds.length === 0 || includeTagIds.some((tagId) => (task.tagIds || []).includes(tagId)))
      .filter((task) => excludeTagIds.length === 0 || !excludeTagIds.some((tagId) => (task.tagIds || []).includes(tagId)))
      .map(compactTaskSummary);
    return { tasks };
  }

  async function taskMakePlannedAt(payload) {
    payload = payload || {};
    const date = payload.date;
    const time = payload.time || '09:00';
    const timezone = payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    if (!isLocalDateString(date)) throw typedError('INVALID_REQUEST', 'date must be YYYY-MM-DD', false);
    if (!/^\d{1,2}:\d{2}$/.test(time)) throw typedError('INVALID_REQUEST', 'time must be HH:MM', false);
    const plannedAt = zonedWallTimeToMs(date, time, timezone);
    return { plannedAt, iso: new Date(plannedAt).toISOString(), timezone };
  }

  async function taskAutoSchedule(payload) {
    payload = payload || {};
    const startDate = payload.startDate || payload.start_date;
    const endDate = payload.endDate || payload.end_date || startDate;
    if (!isLocalDateString(startDate)) throw typedError('INVALID_REQUEST', 'startDate must be YYYY-MM-DD', false);
    if (!isLocalDateString(endDate)) throw typedError('INVALID_REQUEST', 'endDate must be YYYY-MM-DD', false);
    const timezone = payload.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const capacityMs = Math.max(1, Number(valueOf(payload, 'capacityPerDayMinutes', 'capacity_per_day_minutes') || 240)) * 60000;
    const defaultEstimateMs = Math.max(1, Number(valueOf(payload, 'defaultEstimateMinutes', 'default_estimate_minutes') || 30)) * 60000;
    const workStart = payload.workStart || payload.work_start || (payload.workHours && payload.workHours[0] && payload.workHours[0].start) || '09:00';
    const dryRun = valueOf(payload, 'dryRun', 'dry_run') !== false || valueOf(payload, 'confirmApply', 'confirm_apply') !== true;
    const candidates = (await getTasksBySource('active'))
      .filter((task) => !task.isDone && !task.isArchived && task.plannedAt == null)
      .filter((task) => !(payload.rules && payload.rules.topLevelOnly) || !task.parentId)
      .filter((task) => !(payload.includeProjectIds && payload.includeProjectIds.length) || payload.includeProjectIds.includes(task.projectId))
      .filter((task) => !(payload.excludeProjectIds && payload.excludeProjectIds.length) || !payload.excludeProjectIds.includes(task.projectId))
      .sort((a, b) => String(a.dueDay || '9999-99-99').localeCompare(String(b.dueDay || '9999-99-99')) || String(a.title || '').localeCompare(String(b.title || '')));
    const days = localDateRange(startDate, endDate).map((date) => ({ date, usedMs: 0, nextMs: zonedWallTimeToMs(date, workStart, timezone) }));
    const updates = [];
    const skipped = [];
    for (const task of candidates) {
      const estimateMs = Number(task.timeEstimate) > 0 ? Number(task.timeEstimate) : defaultEstimateMs;
      const day = days.find((candidate) => candidate.usedMs + estimateMs <= capacityMs);
      if (!day) { skipped.push(Object.assign(compactTaskSummary(task), { reason: 'capacity_exhausted' })); continue; }
      updates.push({ taskId: task.id, plannedAt: day.nextMs });
      day.usedMs += estimateMs;
      day.nextMs += estimateMs;
    }
    const result = { dryRun, startDate, endDate, timezone, updates, scheduledCount: updates.length, skipped };
    if (!dryRun) result.results = (await taskBulkUpdateCore({ updates, dryRun: false }, ['plannedAt'])).results;
    return result;
  }

  async function taskCompactNotes(payload) {
    payload = payload || {};
    const taskId = valueOf(payload, 'taskId', 'task_id');
    const replacementNotes = valueOf(payload, 'replacementNotes', 'replacement_notes');
    if (!taskId) throw typedError('INVALID_REQUEST', 'taskId is required', false);
    if (typeof replacementNotes !== 'string') throw typedError('INVALID_REQUEST', 'replacementNotes is required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    const dryRun = valueOf(payload, 'dryRun', 'dry_run') !== false || valueOf(payload, 'confirmApply', 'confirm_apply') !== true;
    const oldLength = String(task.notes || '').length;
    const result = { dryRun, taskId, title: task.title, oldLength, newLength: replacementNotes.length, delta: replacementNotes.length - oldLength };
    if (!dryRun) {
      await PluginAPI.updateTask(taskId, { notes: replacementNotes });
      result.updated = true;
    }
    return result;
  }

  function compactTaskSummary(task) {
    return { id: task.id, title: task.title, projectId: task.projectId, parentId: task.parentId, dueDay: task.dueDay, plannedAt: task.plannedAt, timeEstimate: task.timeEstimate, isDone: !!task.isDone, isArchived: !!task.isArchived, notesLength: String(task.notes || '').length };
  }
  function hasSuspiciousDatesOrEstimates(task) {
    const tenYears = Date.now() + 10 * 365 * 86400000;
    const oneYearMs = 365 * 86400000;
    if (task.dueDay != null && !isLocalDateString(task.dueDay)) return true;
    if (task.plannedAt != null && (!Number.isFinite(Number(task.plannedAt)) || Number(task.plannedAt) < 0 || Number(task.plannedAt) > tenYears)) return true;
    if (task.timeEstimate != null && (!Number.isFinite(Number(task.timeEstimate)) || Number(task.timeEstimate) < 0 || Number(task.timeEstimate) > oneYearMs)) return true;
    return false;
  }
  function isLocalDateString(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
  function dayRangeMs(dateStr) {
    const parts = dateStr.split('-').map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
    return [start, start + 86400000];
  }

  function localDateRange(startDate, endDate) {
    const dates = [];
    const parts = startDate.split('-').map(Number);
    const endMs = dayRangeMs(endDate)[0];
    for (let cursor = new Date(parts[0], parts[1] - 1, parts[2]); cursor.getTime() <= endMs; cursor.setDate(cursor.getDate() + 1)) {
      dates.push(localDateStr(cursor));
      if (localDateStr(cursor) === endDate) break;
    }
    return dates;
  }

  function zonedWallTimeToMs(dateStr, timeStr, timezone) {
    const dateParts = dateStr.split('-').map(Number);
    const timeParts = timeStr.split(':').map(Number);
    if (!timezone || timezone === 'local' || timezone === Intl.DateTimeFormat().resolvedOptions().timeZone) return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1]).getTime();
    const targetWall = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1]);
    let guess = targetWall;
    for (let i = 0; i < 4; i++) {
      const parts = zonedDateParts(new Date(guess), timezone);
      const actualWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
      const delta = targetWall - actualWall;
      if (delta === 0) break;
      guess += delta;
    }
    return guess;
  }

  function zonedDateParts(date, timezone) {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
  }

  async function taskPlanToday(payload) {
    const taskIds = valueOf(payload || {}, 'taskIds', 'task_ids') || [];
    const plannedAt = payload && payload.unplan ? null : startOfTodayMs();
    return taskBulkUpdate({ updates: taskIds.map((taskId) => ({ taskId, plannedAt })) });
  }

  async function taskAddTag(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    const tagId = valueOf(payload || {}, 'tagId', 'tag_id');
    if (!taskId || !tagId) throw typedError('INVALID_REQUEST', 'taskId and tagId are required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    const tagIds = task.tagIds || [];
    if (tagIds.includes(tagId)) return { added: false };
    await PluginAPI.updateTask(taskId, { tagIds: tagIds.concat([tagId]) });
    return { added: true };
  }

  async function taskRemoveTag(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    const tagId = valueOf(payload || {}, 'tagId', 'tag_id');
    if (!taskId || !tagId) throw typedError('INVALID_REQUEST', 'taskId and tagId are required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    const tagIds = task.tagIds || [];
    if (!tagIds.includes(tagId)) throw typedError('TAG_NOT_ON_TASK', 'Tag ' + tagId + ' not on task ' + taskId, false);
    await PluginAPI.updateTask(taskId, { tagIds: tagIds.filter((id) => id !== tagId) });
    return { removed: true };
  }

  async function taskMoveToProject(payload) {
    const taskId = valueOf(payload || {}, 'taskId', 'task_id');
    const projectId = valueOf(payload || {}, 'projectId', 'project_id');
    if (!taskId || !projectId) throw typedError('INVALID_REQUEST', 'taskId and projectId are required', false);
    const task = await findTask(taskId);
    if (!task) throw typedError('TASK_NOT_FOUND', 'Task ' + taskId + ' not found', false);
    if (task.parentId) throw typedError('TASK_IS_SUBTASK', 'Cannot move subtask ' + taskId, false, { parentId: task.parentId });
    if (typeof PluginAPI.getAllProjects === 'function') {
      const projects = await PluginAPI.getAllProjects();
      if (!projects.find((project) => project.id === projectId)) throw typedError('PROJECT_NOT_FOUND', 'Project ' + projectId + ' not found', false);
    }
    await PluginAPI.updateTask(taskId, { projectId });
    return { moved: true };
  }

  async function taskWorklog(payload) {
    const startDate = valueOf(payload || {}, 'startDate', 'start_date');
    const endDate = valueOf(payload || {}, 'endDate', 'end_date') || startDate;
    const tasks = await PluginAPI.getTasks();
    const entries = [];
    for (const task of tasks) {
      for (const entry of normalizeWorklogEntries(task)) {
        if (startDate && entry.date < startDate) continue;
        if (endDate && entry.date > endDate) continue;
        entries.push({ date: entry.date, taskId: task.id, title: task.title, projectId: task.projectId, tagIds: task.tagIds || [], timeMs: entry.timeMs });
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || String(a.title || '').localeCompare(String(b.title || '')));
    return { entries, totalMs: entries.reduce((sum, entry) => sum + entry.timeMs, 0) };
  }

  function normalizeWorklogEntries(task) {
    const raw = task.timeSpentOnDay || task.timeSpentByDay || task.timeSpentOnDayMap;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => ({ date: entry.date || entry.day, timeMs: Number(entry.timeMs != null ? entry.timeMs : entry.timeSpent != null ? entry.timeSpent : entry.duration || 0) }))
        .filter((entry) => entry.date && entry.timeMs > 0);
    }
    return Object.entries(raw)
      .map((pair) => ({ date: pair[0], timeMs: Number(pair[1] || 0) }))
      .filter((entry) => entry.date && entry.timeMs > 0);
  }

  function mapTaskUpdate(item) {
    const data = {};
    const mappings = [
      ['title', 'title'], ['notes', 'notes'], ['isDone', 'is_done'], ['dueDay', 'due_day'], ['plannedAt', 'planned_at'],
      ['timeEstimate', 'time_estimate'], ['timeSpent', 'time_spent'], ['tagIds', 'tag_ids'], ['projectId', 'project_id']
    ];
    for (const pair of mappings) {
      const value = valueOf(item, pair[0], pair[1]);
      if (value !== undefined) data[pair[0]] = pair[0] === 'dueDay' && value === '' ? null : value;
    }
    if (typeof data.isDone === 'boolean') data.doneOn = data.isDone ? Date.now() : null;
    return data;
  }

  function startOfTodayMs() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  const handlers = {
    'task.create': taskCreate,
    'task.createWithSubtasks': taskCreateWithSubtasks,
    'task.list': taskList,
    'task.listArchived': taskArchivedList,
    'task.listCurrentContext': taskCurrentContextList,
    'task.get': taskGet,
    'task.update': taskUpdate,
    'task.setRecurrence': taskSetRecurrence,
    'task.updateRecurrence': taskUpdateRecurrence,
    'task.deleteRecurrence': taskDeleteRecurrence,
    'task.complete': taskComplete,
    'task.uncomplete': taskUncomplete,
    'task.archive': taskArchive,
    'task.restore': taskRestore,
    'task.delete': taskDelete,
    'task.addTime': taskAddTime,
    'task.reorder': taskReorder,
    'task.reorderTasks': taskReorder,
    'task.start': taskStart,
    'task.stop': taskStop,
    'task.current': taskCurrent,
    'task.bulkComplete': taskBulkComplete,
    'task.bulkUpdate': taskBulkUpdate,
    'task.bulkReschedule': taskBulkReschedule,
    'task.clearScheduleForDay': taskClearScheduleForDay,
    'task.scheduleHealth': taskScheduleHealth,
    'task.scheduleRange': taskScheduleRange,
    'task.findStaleSchedule': taskFindStaleSchedule,
    'task.findUnscheduledActive': taskFindUnscheduledActive,
    'task.makePlannedAt': taskMakePlannedAt,
    'task.autoSchedule': taskAutoSchedule,
    'task.compactNotes': taskCompactNotes,
    'task.planToday': taskPlanToday,
    'task.addTag': taskAddTag,
    'task.removeTag': taskRemoveTag,
    'task.moveToProject': taskMoveToProject,
    'task.worklog': taskWorklog,
    'project.list': async () => ({ projects: await PluginAPI.getAllProjects() }),
    'project.create': async (payload) => ({ projectId: await PluginAPI.addProject(payload || {}) }),
    'project.update': async (payload) => { await PluginAPI.updateProject(payload.projectId, payload.data || payload); return { updated: true }; },
    'tag.list': async () => ({ tags: await PluginAPI.getAllTags() }),
    'tag.create': async (payload) => ({ tagId: await PluginAPI.addTag(payload || {}) }),
    'tag.update': async (payload) => { await PluginAPI.updateTag(payload.tagId, payload.data || payload); return { updated: true }; },
    'issueProvider.createGitea': issueProviderCreateGitea,
    'notification.show': async (payload) => {
      const message = (payload && payload.message) || '';
      const type = String((payload && payload.type) || 'INFO').toUpperCase();
      if (typeof PluginAPI.showSnack === 'function') await PluginAPI.showSnack({ message, msg: message, type });
      else console.log('[notification:' + type + '] ' + message);
      return { shown: true, type };
    },
    'notification.notify': async (payload) => {
      if (typeof PluginAPI.notify !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.notify is not available in this Super Productivity runtime', false);
      await PluginAPI.notify({ title: (payload && payload.title) || 'Super Productivity MCP', message: (payload && payload.message) || '' });
      return { notified: true };
    },
    'counter.list': async () => {
      if (typeof PluginAPI.getAllCounters !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.getAllCounters is not available in this Super Productivity runtime', false);
      return { counters: await PluginAPI.getAllCounters() };
    },
    'counter.get': async (payload) => {
      const id = (payload && (payload.id || payload.counterId || payload.counter_id));
      if (!id) throw typedError('INVALID_REQUEST', 'counter id is required', false);
      if (typeof PluginAPI.getCounter !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.getCounter is not available in this Super Productivity runtime', false);
      return { id, value: await PluginAPI.getCounter(id) };
    },
    'counter.set': async (payload) => {
      const id = (payload && (payload.id || payload.counterId || payload.counter_id));
      if (!id) throw typedError('INVALID_REQUEST', 'counter id is required', false);
      const value = Number((payload && payload.value) || 0);
      if (typeof PluginAPI.setCounter !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.setCounter is not available in this Super Productivity runtime', false);
      await PluginAPI.setCounter(id, value);
      return { id, value };
    },
    'counter.increment': async (payload) => {
      const id = (payload && (payload.id || payload.counterId || payload.counter_id));
      if (!id) throw typedError('INVALID_REQUEST', 'counter id is required', false);
      if (typeof PluginAPI.incrementCounter !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.incrementCounter is not available in this Super Productivity runtime', false);
      return { id, value: await PluginAPI.incrementCounter(id, Number((payload && payload.delta) || 1)) };
    },
    'counter.decrement': async (payload) => {
      const id = (payload && (payload.id || payload.counterId || payload.counter_id));
      if (!id) throw typedError('INVALID_REQUEST', 'counter id is required', false);
      if (typeof PluginAPI.decrementCounter !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.decrementCounter is not available in this Super Productivity runtime', false);
      return { id, value: await PluginAPI.decrementCounter(id, Number((payload && payload.delta) || 1)) };
    },
    'counter.delete': async (payload) => {
      const id = (payload && (payload.id || payload.counterId || payload.counter_id));
      if (!id) throw typedError('INVALID_REQUEST', 'counter id is required', false);
      if (typeof PluginAPI.deleteCounter !== 'function') throw typedError('UNSUPPORTED_ACTION', 'PluginAPI.deleteCounter is not available in this Super Productivity runtime', false);
      await PluginAPI.deleteCounter(id);
      return { id, deleted: true };
    },
    'bridge.health': async () => ({ ok: true, message: 'bridge alive', dirs }),
    'bridge.checkConnection': async () => ({ ok: true, message: 'bridge alive', dirs }),
    'bridge.debugDirectories': async () => ({ ok: true, dirs }),
    'bridge.capabilities': async () => ({ supportedActions, pluginVersion: '0.1.0', protocolVersion: PROTOCOL_VERSION }),
  };

  const supportedActions = Object.freeze(Object.keys(handlers).sort());

  async function handleRequestFile(filePath) {
    let processingPath = null;
    let envelope = null;
    let responseId = 'err_' + Date.now();
    try {
      processingPath = await moveToProcessing(filePath);
      envelope = await readEnvelope(processingPath);
      responseId = envelope && envelope.id ? envelope.id : responseId;
      const invalid = validateEnvelope(envelope);
      if (invalid) {
        await writeEnvelopeAtomic(dirs.deadletter, responseId, envelope || {});
        await writeEnvelopeAtomic(dirs.outbox, responseId, makeErrResponse(responseId, invalid));
        return;
      }
      const fn = handlers[envelope.action];
      if (!fn) {
        await writeEnvelopeAtomic(dirs.outbox, envelope.id, makeErrResponse(envelope.id, typedError('UNSUPPORTED_ACTION', 'Unsupported action ' + envelope.action, false)));
        return;
      }
      const result = await fn(envelope.payload || {});
      await writeEnvelopeAtomic(dirs.outbox, envelope.id, makeOkResponse(envelope.id, result));
    } catch (error) {
      const e = error && error.code ? error : typedError('INTERNAL', (error && error.message) || 'Unknown bridge error', false);
      await writeEnvelopeAtomic(dirs.outbox, responseId, makeErrResponse(responseId, e));
    } finally {
      if (processingPath) {
        try { await removeFile(processingPath); } catch (e) {}
      }
    }
  }

  async function tick() {
    if (!dirs) return;
    const files = await listRequestFiles(dirs.inbox);
    for (const file of files) await handleRequestFile(file);
  }

  async function init() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    let delay = INITIAL_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        dirs = await setupDirectories();
        await cleanStaleFiles();
        pollTimer = setInterval(() => tick().catch((e) => console.error('MCP bridge tick error', e)), POLL_INTERVAL_MS);
        if (typeof window !== 'undefined') window.mcpBridge = { dirs, tick };
        console.log('MCP Bridge v2 ready', dirs);
        return;
      } catch (e) {
        console.error('MCP Bridge init attempt ' + attempt + '/' + MAX_RETRIES + ' failed:', e);
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 10000);
        }
      }
    }
    console.error('MCP Bridge init failed after all retries');
  }

  setTimeout(init, 500);
})();
