const os = require("os");
const path = require("path");

const actions = require("./actions");
const { typedError } = require("./errors");
const {
  ensureDirs,
  listRequestFiles,
  moveToProcessing,
  readEnvelope,
  writeEnvelopeAtomic,
  makeOkResponse,
  makeErrResponse,
  validateEnvelope,
} = require("./ipc");

class MCPBridgePluginV2 {
  constructor() {
    this.baseDir = process.env.SP_MCP_DATA_DIR || this.defaultDataDir();
    this.pollMs = Number(process.env.SP_MCP_POLL_INTERVAL_MS || 1500);
    this.dirs = null;
    this.interval = null;
    this.handlers = actions;
  }

  defaultDataDir() {
    if (os.platform() === "win32") {
      return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "super-productivity-mcp");
    }
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "super-productivity-mcp");
  }

  async init() {
    this.dirs = await ensureDirs(this.baseDir);
    this.interval = setInterval(() => {
      this.tick().catch((e) => console.error("MCP bridge tick error", e));
    }, this.pollMs);
    console.log("MCP Bridge v2 ready", this.dirs);
  }

  async tick() {
    const files = await listRequestFiles(this.dirs.inbox);
    for (const file of files) {
      await this.handleRequestFile(file);
    }
  }

  async handleRequestFile(filePath) {
    let processingPath = null;
    try {
      processingPath = await moveToProcessing(filePath, this.dirs.processing);
      const envelope = await readEnvelope(processingPath);
      const invalid = validateEnvelope(envelope);
      if (invalid) {
        await writeEnvelopeAtomic(this.dirs.deadletter, envelope?.id || `bad_${Date.now()}`, envelope || {});
        await writeEnvelopeAtomic(this.dirs.outbox, envelope?.id || `bad_${Date.now()}`, makeErrResponse(envelope?.id || "unknown", invalid));
        return;
      }

      const fn = this.handlers[envelope.action];
      if (!fn) {
        await writeEnvelopeAtomic(
          this.dirs.outbox,
          envelope.id,
          makeErrResponse(envelope.id, typedError("UNSUPPORTED_ACTION", `Unsupported action ${envelope.action}`, false)),
        );
        return;
      }

      const result = await fn(envelope.payload || {});
      await writeEnvelopeAtomic(this.dirs.outbox, envelope.id, makeOkResponse(envelope.id, result));
    } catch (error) {
      const e = error?.code
        ? error
        : typedError("INTERNAL", error?.message || "Unknown bridge error", false);
      const fallbackId = `err_${Date.now()}`;
      await writeEnvelopeAtomic(this.dirs.outbox, fallbackId, makeErrResponse(fallbackId, e));
    } finally {
      if (processingPath) {
        await PluginAPI.executeNodeScript({
          script: `
            const fs = require('fs');
            if (fs.existsSync(args[0])) fs.unlinkSync(args[0]);
            return { ok: true };
          `,
          args: [processingPath],
          timeout: 2000,
        }).catch(() => {});
      }
    }
  }

  async cleanup() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

async function startBridge() {
  const bridge = new MCPBridgePluginV2();
  await bridge.init();
  if (typeof window !== "undefined") {
    window.mcpBridge = bridge;
  }
  return bridge;
}

module.exports = {
  MCPBridgePluginV2,
  startBridge,
};
