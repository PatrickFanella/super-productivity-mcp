#!/usr/bin/env -S deno run --allow-run --allow-env --allow-read

export {};
declare const Deno: any;

interface RpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface Catalog {
  tools?: Array<{ mcpName?: string }>;
  resources?: Array<{ uri?: string }>;
}

function arg(name: string, fallback?: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index >= 0 && index + 1 < Deno.args.length
    ? Deno.args[index + 1]
    : fallback;
}

const command = arg("--command") || Deno.env.get("SP_MCP_COMMAND") || "";
const timeoutMs = Number(arg("--timeout-ms", "10000"));
const catalogPath = arg("--catalog");

if (!command) {
  console.error("FAIL --command or SP_MCP_COMMAND is required");
  Deno.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("FAIL --timeout-ms must be a positive number");
  Deno.exit(2);
}

const process = new Deno.Command(command, {
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
}).spawn();
const writer = process.stdin.getWriter();
const reader = process.stdout.pipeThrough(new TextDecoderStream()).getReader();
const stderrPromise = new Response(process.stderr).text();
let buffer = "";

async function write(message: unknown): Promise<void> {
  await writer.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
}

async function readLine(): Promise<string> {
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) return line;
      continue;
    }
    const chunk = await reader.read();
    if (chunk.done) {
      const line = buffer.trim();
      buffer = "";
      if (line) return line;
      throw new Error("server closed stdout before responding");
    }
    buffer += chunk.value;
  }
}

async function responseFor(id: number): Promise<RpcResponse> {
  const operation = (async () => {
    while (true) {
      const line = await readLine();
      let message: RpcResponse;
      try {
        message = JSON.parse(line);
      } catch {
        throw new Error(`non-JSON stdout: ${line.slice(0, 500)}`);
      }
      if (message.id === id) return message;
    }
  })();
  return await Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

async function request(id: number, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  await write({ jsonrpc: "2.0", id, method, params });
  const response = await responseFor(id);
  if (response.error) {
    throw new Error(`${method}: ${response.error.code} ${response.error.message}`);
  }
  if (response.jsonrpc !== "2.0" || !response.result) {
    throw new Error(`${method}: invalid JSON-RPC response`);
  }
  return response.result;
}

function compareSurface(label: string, expected: string[], actual: string[]): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} drift; missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
    );
  }
  console.log(`OK ${label}: ${actual.length}`);
}

let failure: Error | undefined;
try {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "super-productivity-skill-smoke", version: "1.0.0" },
  });
  if (typeof initialized.protocolVersion !== "string") {
    throw new Error("initialize: result.protocolVersion is missing");
  }
  console.log(`OK initialize: ${initialized.protocolVersion}`);
  await write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const toolsResult = await request(2, "tools/list");
  const resourcesResult = await request(3, "resources/list");
  const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools as Array<{ name?: string }> : [];
  const resources = Array.isArray(resourcesResult.resources)
    ? resourcesResult.resources as Array<{ uri?: string }>
    : [];

  if (catalogPath) {
    const catalog = JSON.parse(await Deno.readTextFile(catalogPath)) as Catalog;
    compareSurface(
      "tools",
      (catalog.tools || []).map((tool) => tool.mcpName || "").filter(Boolean),
      tools.map((tool) => tool.name || "").filter(Boolean),
    );
    compareSurface(
      "resources",
      (catalog.resources || []).map((resource) => resource.uri || "").filter(Boolean),
      resources.map((resource) => resource.uri || "").filter(Boolean),
    );
  } else {
    console.log(`OK tools/list: ${tools.length}`);
    console.log(`OK resources/list: ${resources.length}`);
  }
} catch (error) {
  failure = error as Error;
} finally {
  try {
    await writer.close();
  } catch {
    // Process may already have exited.
  }
  try {
    process.kill("SIGTERM");
  } catch {
    // Process already exited.
  }
  try {
    await process.status;
  } catch {
    // Preserve the primary failure.
  }
}

const stderr = (await stderrPromise).trim();
if (failure) {
  console.error(`FAIL ${failure.message}`);
  if (stderr) console.error(stderr.slice(-4000));
  Deno.exit(1);
}
