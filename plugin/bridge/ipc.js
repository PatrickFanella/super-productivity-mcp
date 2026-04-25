const path = require("path");
const { typedError } = require("./errors");

const PROTOCOL_VERSION = "2.0";

async function execScript(script, args = [], timeout = 5000) {
  const result = await PluginAPI.executeNodeScript({ script, args, timeout });
  return result?.result ?? result;
}

async function ensureDirs(baseDir) {
  return execScript(
    `
      const fs = require('fs');
      const path = require('path');
      const baseDir = args[0];
      const dirs = ['inbox','processing','outbox','events','deadletter'];
      for (const d of dirs) fs.mkdirSync(path.join(baseDir, d), { recursive: true });
      return {
        inbox: path.join(baseDir, 'inbox'),
        processing: path.join(baseDir, 'processing'),
        outbox: path.join(baseDir, 'outbox'),
        events: path.join(baseDir, 'events'),
        deadletter: path.join(baseDir, 'deadletter')
      };
    `,
    [baseDir],
  );
}

async function listRequestFiles(inboxDir) {
  const res = await execScript(
    `
      const fs = require('fs');
      const path = require('path');
      const files = fs.readdirSync(args[0]).filter((f) => f.endsWith('.json'));
      return files.map((f) => path.join(args[0], f));
    `,
    [inboxDir],
  );
  return Array.isArray(res) ? res : [];
}

async function moveToProcessing(filePath, processingDir) {
  return execScript(
    `
      const fs = require('fs');
      const path = require('path');
      const src = args[0];
      const dst = path.join(args[1], path.basename(src));
      fs.renameSync(src, dst);
      return dst;
    `,
    [filePath, processingDir],
  );
}

async function readEnvelope(filePath) {
  return execScript(
    `
      const fs = require('fs');
      return JSON.parse(fs.readFileSync(args[0], 'utf8'));
    `,
    [filePath],
  );
}

async function writeEnvelopeAtomic(dir, id, envelope) {
  return execScript(
    `
      const fs = require('fs');
      const path = require('path');
      const dir = args[0];
      const id = args[1];
      const envelope = args[2];
      const finalPath = path.join(dir, id + '.json');
      const tmpPath = finalPath + '.tmp.' + Date.now();
      fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2));
      fs.renameSync(tmpPath, finalPath);
      return finalPath;
    `,
    [dir, id, envelope],
  );
}

function makeOkResponse(id, result = {}, meta = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    type: "response",
    status: "ok",
    result,
    error: null,
    meta: { handledAt: new Date().toISOString(), ...meta },
  };
}

function makeErrResponse(id, err, meta = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id,
    type: "response",
    status: "error",
    result: {},
    error: err,
    meta: { handledAt: new Date().toISOString(), ...meta },
  };
}

function validateEnvelope(env) {
  if (!env || typeof env !== "object") {
    return typedError("INVALID_ENVELOPE", "Envelope must be an object", false);
  }
  if (env.protocolVersion !== PROTOCOL_VERSION) {
    return typedError("INCOMPATIBLE_PROTOCOL", `Expected protocol ${PROTOCOL_VERSION}`, false, {
      got: env.protocolVersion,
    });
  }
  if (env.type !== "request") {
    return typedError("INVALID_TYPE", "Envelope type must be request", false, {
      got: env.type,
    });
  }
  if (!env.id || !env.action) {
    return typedError("INVALID_REQUEST", "Request must include id and action", false);
  }
  return null;
}

module.exports = {
  PROTOCOL_VERSION,
  ensureDirs,
  listRequestFiles,
  moveToProcessing,
  readEnvelope,
  writeEnvelopeAtomic,
  makeOkResponse,
  makeErrResponse,
  validateEnvelope,
};
