const { typedError } = require("../errors");

function localRestConfig() {
  const env = typeof process === "undefined" ? {} : process.env || {};
  const baseUrl = (env.SP_LOCAL_REST_URL || env.SUPER_PRODUCTIVITY_REST_URL || "").trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token: (env.SP_LOCAL_REST_TOKEN || "").trim(),
  };
}

async function request(config, path, options = {}) {
  if (typeof fetch !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "Local REST support requires a runtime with fetch support", false);
  }
  const headers = {};
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
  });
  if (!response.ok) {
    const body = await safeResponseText(response);
    throw typedError(options.errorCode || "LOCAL_REST_FAILED", `Local REST request failed (${response.status}): ${body || response.statusText}`, false, { status: response.status });
  }
  return parseResponse(response);
}

async function archiveTask(taskId) {
  const config = localRestConfig();
  if (!config) return false;
  await request(config, `/tasks/${encodeURIComponent(taskId)}/archive`, { method: "POST", errorCode: "LOCAL_REST_ARCHIVE_FAILED" });
  return true;
}

async function restoreTask(taskId) {
  const config = localRestConfig();
  if (!config) throw typedError("UNSUPPORTED_ACTION", "Restore requires SP_LOCAL_REST_URL or SUPER_PRODUCTIVITY_REST_URL", false);
  await request(config, `/tasks/${encodeURIComponent(taskId)}/restore`, { method: "POST", errorCode: "LOCAL_REST_RESTORE_FAILED" });
}

async function startTask(taskId) {
  const config = localRestConfig();
  if (!config) return false;
  await request(config, `/tasks/${encodeURIComponent(taskId)}/start`, { method: "POST", errorCode: "LOCAL_REST_START_FAILED" });
  return true;
}

async function stopCurrentTask() {
  const config = localRestConfig();
  if (!config) return false;
  await request(config, "/task-control/stop", { method: "POST", errorCode: "LOCAL_REST_STOP_FAILED" });
  return true;
}

async function getCurrentTask() {
  const config = localRestConfig();
  if (!config) return { configured: false, task: null };
  const body = await request(config, "/task-control/current", { errorCode: "LOCAL_REST_CURRENT_FAILED" });
  return { configured: true, task: normalizeCurrentTaskResponse(body) };
}

function normalizeCurrentTaskResponse(body) {
  if (!body) return null;
  if (body.task !== undefined) return body.task;
  if (body.currentTask !== undefined) return body.currentTask;
  if (body.id || body.title) return body;
  return null;
}

async function parseResponse(response) {
  const body = await safeResponseText(response);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (_err) {
    return body;
  }
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch (_err) {
    return "";
  }
}

module.exports = {
  archiveTask,
  getCurrentTask,
  localRestConfig,
  request,
  restoreTask,
  startTask,
  stopCurrentTask,
};
