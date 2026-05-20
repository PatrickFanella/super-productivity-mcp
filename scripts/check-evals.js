#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const contract = require("./catalog-contract");

const rootDir = path.resolve(__dirname, "..");
const evalPath = path.join(rootDir, "docs", "evals", "mcp-schedule-evals.xml");

function fail(message) {
  console.error(`check-evals: ${message}`);
  process.exit(1);
}

const xml = fs.readFileSync(evalPath, "utf8");
const facts = contract.deriveCatalogFacts(contract.readCatalog());
const toolNames = facts.mcpNameSet;
const resourceUris = facts.resourceUriSet;
const pairs = [...xml.matchAll(/<qa_pair>\s*<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<\/qa_pair>/g)]
  .map((match) => ({ question: match[1].trim(), answer: match[2].trim() }));

if (!xml.trim().startsWith("<evaluation>") || !xml.trim().endsWith("</evaluation>")) {
  fail("expected <evaluation> root element");
}
if (pairs.length < 10) fail(`expected at least 10 qa_pair entries, got ${pairs.length}`);

const seenQuestions = new Set();
for (const [index, pair] of pairs.entries()) {
  if (!pair.question || !pair.answer) fail(`qa_pair ${index + 1} has empty question or answer`);
  if (seenQuestions.has(pair.question)) fail(`duplicate question: ${pair.question}`);
  seenQuestions.add(pair.question);
}

for (const required of ["get_schedule_health", "find_unscheduled_active_tasks", "get_schedule_range", "auto_schedule_tasks", "compact_task_notes"]) {
  if (!pairs.some((pair) => pair.question.includes(required) || pair.answer.includes(required))) fail(`missing eval coverage for ${required}`);
  if (!toolNames.has(required)) fail(`eval references unknown tool ${required}`);
}
for (const required of ["sp://schedule/health", "sp://schedule/today"]) {
  if (!pairs.some((pair) => pair.answer === required)) fail(`missing eval answer coverage for ${required}`);
  if (!resourceUris.has(required)) fail(`eval references unknown resource ${required}`);
}

console.log(`check-evals: ${pairs.length} eval scenarios valid`);
