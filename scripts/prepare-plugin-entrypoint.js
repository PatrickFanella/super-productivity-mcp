#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const rootPluginPath = path.join(rootDir, "plugin.js");
const catalogPath = path.join(rootDir, "internal", "catalog", "tools.json");

function fail(message) {
  console.error(`prepare-plugin-entrypoint: ${message}`);
  process.exit(1);
}

function rootHandlerActions(src) {
  const match = src.match(/const handlers = \{([\s\S]*?)\n  \};/);
  if (!match) fail("root plugin handlers object not found");
  return [...match[1].matchAll(/\n\s{4}'([^']+)':/g)].map((m) => m[1]).sort();
}

function assertSame(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    const missing = expected.filter((x) => !actual.includes(x));
    const extra = actual.filter((x) => !expected.includes(x));
    fail(`${label} drift. missing=${missing.join(",") || "-"} extra=${extra.join(",") || "-"}`);
  }
}

const outPath = process.argv[2];
if (!outPath) fail("usage: prepare-plugin-entrypoint.js <output-plugin.js>");

const rootSrc = fs.readFileSync(rootPluginPath, "utf8");
const runtimeSrc = rootSrc.replace(/`[^`]*`/gs, "``");
if (/require\s*\(/.test(runtimeSrc)) fail("root plugin must remain browser-safe: found require() outside Node script templates");
if (/process\s*\./.test(runtimeSrc)) fail("root plugin must remain browser-safe: found process.* outside Node script templates");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const catalogActions = catalog.tools.map((tool) => tool.action).sort();
assertSame("root plugin handlers vs catalog", rootHandlerActions(rootSrc), catalogActions);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.copyFileSync(rootPluginPath, outPath);
console.error(`prepare-plugin-entrypoint: wrote ${outPath}`);
