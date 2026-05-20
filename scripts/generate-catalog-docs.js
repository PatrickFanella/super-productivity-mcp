#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const contract = require("./catalog-contract");

const rootDir = path.resolve(__dirname, "..");
const catalog = contract.readCatalog();
const outPath = path.join(rootDir, "docs", "tools.md");
const check = process.argv.includes("--check");

function row(cells) {
  return `| ${cells.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
}

const lines = [];
lines.push("# MCP Tool and Resource Catalog");
lines.push("");
lines.push("Generated from `internal/catalog/tools.json`. Do not edit by hand; run `make generate-docs`.");
lines.push("");
lines.push("## Tools");
lines.push("");
lines.push(row(["Tool", "Action", "Description"]));
lines.push(row(["---", "---", "---"]));
for (const tool of catalog.tools) {
  if (tool.internal) continue;
  lines.push(row([`\`${tool.mcpName}\``, `\`${tool.action}\``, tool.description]));
}
lines.push("");
lines.push("## Resources");
lines.push("");
lines.push(row(["URI", "Action", "Description"]));
lines.push(row(["---", "---", "---"]));
for (const resource of catalog.resources || []) {
  lines.push(row([`\`${resource.uri}\``, `\`${resource.action}\``, resource.description]));
}
lines.push("");

const content = `${lines.join("\n")}\n`;
if (check) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  if (existing !== content) {
    console.error("generate-catalog-docs: docs/tools.md is stale; run make generate-docs");
    process.exit(1);
  }
  console.log("generate-catalog-docs: docs/tools.md up to date");
} else {
  fs.writeFileSync(outPath, content);
  console.log(`generate-catalog-docs: wrote ${outPath}`);
}
