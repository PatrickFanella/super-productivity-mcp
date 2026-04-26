#!/usr/bin/env -S deno run --allow-run --allow-env --allow-read

export {};
declare const Deno: any;

/**
 * protocol_smoke.ts
 *
 * Sends a JSON-RPC initialize request to an MCP stdio command and validates
 * that a JSON-RPC response with result.protocolVersion is returned.
 */

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  result?: {
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    serverInfo?: { name?: string; version?: string };
  };
  error?: { code: number; message: string };
}

function arg(name: string, fallback?: string): string | undefined {
  const idx = Deno.args.indexOf(name);
  if (idx !== -1 && idx + 1 < Deno.args.length) return Deno.args[idx + 1];
  return fallback;
}

const command = arg("--command", "./scripts/run-mcp.sh")!;
const timeoutMs = Number(arg("--timeout-ms", "6000"));

const proc = new Deno.Command(command, {
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
}).spawn();

const initReq = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "protocol-smoke", version: "1.0.0" },
  },
};

const writer = proc.stdin.getWriter();
await writer.write(new TextEncoder().encode(JSON.stringify(initReq) + "\n"));
writer.releaseLock();

const stdoutPromise = proc.stdout
  .pipeThrough(new TextDecoderStream())
  .getReader()
  .read();

const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
});

let line = "";
try {
  const out = await Promise.race([stdoutPromise, timeoutPromise]);
  line = out.value ?? "";
} catch (err) {
  proc.kill("SIGTERM");
  console.error(`❌ initialize failed: ${(err as Error).message}`);
  Deno.exit(1);
}

let msg: RpcMessage | null = null;
try {
  msg = JSON.parse(line);
} catch {
  console.error("❌ server returned non-JSON output");
  console.error(line);
  proc.kill("SIGTERM");
  Deno.exit(1);
}

if (!msg) {
  console.error("❌ empty initialize response");
  proc.kill("SIGTERM");
  Deno.exit(1);
}

const parsed: RpcMessage = msg as RpcMessage;

if (parsed.error) {
  console.error(`❌ JSON-RPC error: ${parsed.error.code} ${parsed.error.message}`);
  proc.kill("SIGTERM");
  Deno.exit(1);
}

if (parsed.jsonrpc !== "2.0" || !parsed.result?.protocolVersion) {
  console.error("❌ invalid initialize response shape");
  console.error(JSON.stringify(parsed, null, 2));
  proc.kill("SIGTERM");
  Deno.exit(1);
}

console.log("✅ initialize OK");
console.log(JSON.stringify(parsed.result, null, 2));
proc.kill("SIGTERM");
