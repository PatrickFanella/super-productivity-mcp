#!/usr/bin/env -S deno run --allow-read

export {};
declare const Deno: any;

const path = Deno.args.find((value: string) => !value.startsWith("--"));
const jsonOutput = Deno.args.includes("--json");
if (!path) {
  console.error("usage: catalog_summary.ts [--json] <tool-catalog.json>");
  Deno.exit(2);
}

const catalog = JSON.parse(await Deno.readTextFile(path));
const tools = (catalog.tools || []).map((tool: { mcpName?: string }) => tool.mcpName).filter(Boolean);
const resources = (catalog.resources || []).map((resource: { uri?: string }) => resource.uri).filter(Boolean);
const duplicateTools = tools.filter((name: string, index: number) => tools.indexOf(name) !== index);
const duplicateResources = resources.filter((uri: string, index: number) => resources.indexOf(uri) !== index);
const summary = {
  protocolVersion: catalog.protocolVersion || null,
  toolCount: tools.length,
  resourceCount: resources.length,
  duplicateTools: [...new Set(duplicateTools)],
  duplicateResources: [...new Set(duplicateResources)],
  tools,
  resources,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`protocol: ${summary.protocolVersion}`);
  console.log(`tools: ${summary.toolCount}`);
  console.log(`resources: ${summary.resourceCount}`);
  console.log(`duplicate tools: ${summary.duplicateTools.join(", ") || "none"}`);
  console.log(`duplicate resources: ${summary.duplicateResources.join(", ") || "none"}`);
}

if (summary.duplicateTools.length || summary.duplicateResources.length) Deno.exit(1);
