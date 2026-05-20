#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const contract = require("./catalog-contract");

const rootDir = path.resolve(__dirname, "..");
const rootPluginPath = path.join(rootDir, "plugin.js");

function fail(message) {
  console.error(`prepare-plugin-entrypoint: ${message}`);
  process.exit(1);
}

const outPath = process.argv[2];
if (!outPath) fail("usage: prepare-plugin-entrypoint.js <output-plugin.js>");

const rootSrc = fs.readFileSync(rootPluginPath, "utf8");
try {
  contract.assertRootPluginBrowserSafe(rootSrc);
} catch (error) {
  fail(error.message);
}

const catalogActions = contract.deriveCatalogFacts(contract.readCatalog()).actions;
try {
  contract.assertRootPluginHandlerParity(rootSrc, catalogActions);
  contract.assertRootPluginProjection(rootSrc);
} catch (error) {
  fail(error.message);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.copyFileSync(rootPluginPath, outPath);
console.error(`prepare-plugin-entrypoint: wrote ${outPath}`);
