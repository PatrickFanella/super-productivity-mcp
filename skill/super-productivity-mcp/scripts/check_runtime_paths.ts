#!/usr/bin/env -S deno run --allow-read --allow-env

export {};
declare const Deno: any;

/**
 * check_runtime_paths.ts
 *
 * Validates runtime assumptions for Super Productivity MCP.
 */

function arg(name: string, fallback?: string): string | undefined {
  const idx = Deno.args.indexOf(name);
  if (idx !== -1 && idx + 1 < Deno.args.length) return Deno.args[idx + 1];
  return fallback;
}

const dataDir = arg("--data-dir", Deno.env.get("SP_MCP_DATA_DIR") || "") || "";
const launcher = arg("--launcher", "./scripts/run-mcp.sh")!;

const requiredDirs = ["inbox", "processing", "outbox", "events", "deadletter"];

function checkPath(path: string): boolean {
  try {
    const st = Deno.statSync(path);
    return st.isDirectory || st.isFile;
  } catch {
    return false;
  }
}

let ok = true;

if (!checkPath(launcher)) {
  console.error(`❌ launcher missing: ${launcher}`);
  ok = false;
} else {
  console.log(`✅ launcher present: ${launcher}`);
}

if (!dataDir) {
  console.error("❌ SP_MCP_DATA_DIR not set and no --data-dir provided");
  ok = false;
} else {
  console.log(`ℹ️ data dir: ${dataDir}`);
  for (const d of requiredDirs) {
    const p = `${dataDir}/${d}`;
    if (checkPath(p)) {
      console.log(`✅ ${d}`);
    } else {
      console.error(`❌ missing ${d}: ${p}`);
      ok = false;
    }
  }
}

if (!ok) {
  Deno.exit(1);
}

console.log("✅ runtime paths look healthy");
