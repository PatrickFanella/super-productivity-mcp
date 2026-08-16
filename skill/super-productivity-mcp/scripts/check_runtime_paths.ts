#!/usr/bin/env -S deno run --allow-read --allow-env

export {};
declare const Deno: any;

function arg(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index >= 0 && index + 1 < Deno.args.length
    ? Deno.args[index + 1]
    : undefined;
}

const launcherArg = arg("--launcher") || Deno.env.get("SP_MCP_COMMAND") || "";
const dataDirArg = arg("--data-dir") || Deno.env.get("SP_MCP_DATA_DIR") || "";
const jsonOutput = Deno.args.includes("--json");
const requiredDirs = ["inbox", "processing", "outbox", "events", "deadletter"];
const checks: Array<{ name: string; ok: boolean; path: string; detail?: string }> = [];

function resolve(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
}

function checkLauncher(path: string): void {
  if (!path) {
    checks.push({ name: "launcher", ok: false, path, detail: "not provided" });
    return;
  }
  try {
    const stat = Deno.statSync(path);
    const executable = Deno.build.os === "windows" ||
      (typeof stat.mode === "number" && (stat.mode & 0o111) !== 0);
    checks.push({
      name: "launcher",
      ok: stat.isFile && executable,
      path: resolve(path),
      detail: !stat.isFile ? "not a regular file" : !executable ? "not executable" : undefined,
    });
  } catch (error) {
    checks.push({
      name: "launcher",
      ok: false,
      path,
      detail: (error as Error).message,
    });
  }
}

function checkDirectory(base: string, name: string): void {
  const path = `${base}/${name}`;
  try {
    const stat = Deno.statSync(path);
    if (stat.isDirectory) {
      Deno.readDirSync(path);
    }
    checks.push({
      name,
      ok: stat.isDirectory,
      path: resolve(path),
      detail: stat.isDirectory ? undefined : "not a directory",
    });
  } catch (error) {
    checks.push({ name, ok: false, path, detail: (error as Error).message });
  }
}

checkLauncher(launcherArg);
if (!dataDirArg) {
  checks.push({ name: "data-dir", ok: false, path: "", detail: "not provided" });
} else {
  for (const name of requiredDirs) checkDirectory(dataDirArg, name);
}

const ok = checks.every((check) => check.ok);
if (jsonOutput) {
  console.log(JSON.stringify({ ok, launcher: resolve(launcherArg), dataDir: resolve(dataDirArg), checks }, null, 2));
} else {
  for (const check of checks) {
    const symbol = check.ok ? "OK" : "FAIL";
    const detail = check.detail ? ` (${check.detail})` : "";
    console.log(`${symbol} ${check.name}: ${check.path}${detail}`);
  }
}

if (!ok) Deno.exit(1);
