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
// Every qa_pair must parse whole: once the well-formed pairs are removed,
// nothing but whitespace may remain inside <evaluation>. This catches a
// merge that leaves a half pair or a second root.
const body = xml.trim().slice("<evaluation>".length, -"</evaluation>".length);
const leftover = body.replace(/<qa_pair>\s*<question>[\s\S]*?<\/question>\s*<answer>[\s\S]*?<\/answer>\s*<\/qa_pair>/g, "").trim();
if (leftover) fail(`malformed evaluation XML near: ${leftover.slice(0, 80)}`);
const opened = (xml.match(/<qa_pair>/g) || []).length;
if (opened !== pairs.length) fail(`${opened} <qa_pair> tags but ${pairs.length} complete pairs`);
// Raise this floor when scenarios are added, so a merge that drops one fails.
const MIN_SCENARIOS = 21;
if (pairs.length < MIN_SCENARIOS) fail(`expected at least ${MIN_SCENARIOS} qa_pair entries, got ${pairs.length}`);

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
