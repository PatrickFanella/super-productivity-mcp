const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const canonicalCatalogPath = path.join(rootDir, "internal", "catalog", "tools.json");
const syncedCatalogPaths = [
  path.join(rootDir, "plugin", "bridge", "tool-catalog.json"),
  path.join(rootDir, "skill", "super-productivity-mcp", "data", "tool-catalog.json"),
];
const rootPluginPath = path.join(rootDir, "plugin.js");
const modularHandlersPath = path.join(rootDir, "plugin", "bridge", "actions");
const catalogDerivedDocPaths = [
  path.join(rootDir, "README.md"),
  path.join(rootDir, "skill", "super-productivity-mcp", "SKILL.md"),
  path.join(rootDir, "skill", "super-productivity-mcp", "references", "ops-checklist.md"),
];
const staleCatalogSurfacePatterns = [
  {
    label: "hard-coded tool/resource count",
    pattern: /\b\d+\s+tools?\s+plus\s+\d+\s+resources?\b/i,
  },
  {
    label: "hard-coded resource count",
    pattern: /\ball\s+\d+\s+expected\s+resources?\b/i,
  },
  {
    label: "legacy four-resource list",
    pattern: /sp:\/\/projects[\s\S]{0,120}sp:\/\/tags[\s\S]{0,120}sp:\/\/tasks\/today[\s\S]{0,120}sp:\/\/tasks\/overdue/i,
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameMembers(label, actual, expected) {
  const actualSorted = uniqueSorted(actual);
  const expectedSorted = uniqueSorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const missing = expectedSorted.filter((value) => !actualSorted.includes(value));
    const extra = actualSorted.filter((value) => !expectedSorted.includes(value));
    throw new Error(`${label} drift. missing=${missing.join(",") || "-"} extra=${extra.join(",") || "-"}`);
  }
}

function readCatalog(catalogPath = canonicalCatalogPath) {
  return readJson(catalogPath);
}

function deriveCatalogFacts(catalog = readCatalog()) {
  const tools = Array.isArray(catalog.tools) ? catalog.tools : [];
  const resources = Array.isArray(catalog.resources) ? catalog.resources : [];
  const actions = tools.map((tool) => tool && tool.action).filter(Boolean);
  const mcpNames = tools.map((tool) => tool && tool.mcpName).filter(Boolean);
  const resourceUris = resources.map((resource) => resource && resource.uri).filter(Boolean);
  return {
    catalog,
    tools,
    resources,
    actions,
    actionSet: new Set(actions),
    mcpNames,
    mcpNameSet: new Set(mcpNames),
    resourceUris,
    resourceUriSet: new Set(resourceUris),
  };
}

function validateCatalogShape(catalog = readCatalog()) {
  const errors = [];
  if (!isPlainObject(catalog)) errors.push("catalog must be an object");

  const tools = Array.isArray(catalog && catalog.tools) ? catalog.tools : null;
  const resources = Array.isArray(catalog && catalog.resources) ? catalog.resources : [];
  if (!tools) errors.push("catalog.tools must be an array");

  const knownActions = new Set();
  const seenActions = new Set();
  const seenNames = new Set();

  for (const [index, tool] of (tools || []).entries()) {
    if (!isPlainObject(tool)) {
      errors.push(`tools[${index}] must be an object`);
      continue;
    }
    if (typeof tool.action !== "string" || !tool.action.trim()) errors.push(`tools[${index}].action must be a non-empty string`);
    if (typeof tool.description !== "string" || !tool.description.trim()) errors.push(`tools[${index}].description must be a non-empty string`);
    if (!isPlainObject(tool.inputSchema)) errors.push(`tools[${index}].inputSchema must be an object`);
    if (tool.outputSchema !== undefined && !isPlainObject(tool.outputSchema)) errors.push(`tools[${index}].outputSchema must be an object when present`);
    if (tool.action && seenActions.has(tool.action)) errors.push(`duplicate tool action: ${tool.action}`);
    if (tool.action) {
      seenActions.add(tool.action);
      knownActions.add(tool.action);
    }
    if (tool.mcpName !== undefined) {
      if (typeof tool.mcpName !== "string" || !tool.mcpName.trim()) {
        errors.push(`tools[${index}].mcpName must be a non-empty string when present`);
      } else if (seenNames.has(tool.mcpName)) {
        errors.push(`duplicate mcpName: ${tool.mcpName}`);
      } else {
        seenNames.add(tool.mcpName);
      }
    }
  }

  for (const [index, resource] of resources.entries()) {
    if (!isPlainObject(resource)) {
      errors.push(`resources[${index}] must be an object`);
      continue;
    }
    if (typeof resource.uri !== "string" || !resource.uri.trim()) errors.push(`resources[${index}].uri must be a non-empty string`);
    if (typeof resource.action !== "string" || !resource.action.trim()) errors.push(`resources[${index}].action must be a non-empty string`);
    if (resource.action && !knownActions.has(resource.action)) errors.push(`resources[${index}].action references unknown action: ${resource.action}`);
  }

  if (errors.length) {
    throw new Error(`catalog shape invalid:\n- ${errors.join("\n- ")}`);
  }

  return deriveCatalogFacts(catalog);
}

function checkSyncedCatalogCopies(canonicalCatalogPathOverride = canonicalCatalogPath) {
  const canonical = fs.readFileSync(canonicalCatalogPathOverride, "utf8");
  for (const filePath of syncedCatalogPaths) {
    const synced = fs.readFileSync(filePath, "utf8");
    if (synced !== canonical) {
      throw new Error(`synced catalog drift: ${path.relative(rootDir, filePath)}`);
    }
  }
  return { syncedCatalogCount: syncedCatalogPaths.length };
}

function readRootPluginSource(filePath = rootPluginPath) {
  return fs.readFileSync(filePath, "utf8");
}

function stripTemplateLiteralBodies(source) {
  return source.replace(/`[^`]*`/gs, "``");
}

function assertRootPluginBrowserSafe(source = readRootPluginSource()) {
  const runtimeSource = stripTemplateLiteralBodies(source);
  if (/require\s*\(/.test(runtimeSource)) {
    throw new Error("root plugin must remain browser-safe: found require() outside Node script templates");
  }
  if (/process\s*\./.test(runtimeSource)) {
    throw new Error("root plugin must remain browser-safe: found process.* outside Node script templates");
  }
}

function readRootPluginHandlerActions(source = readRootPluginSource()) {
  const match = source.match(/const handlers = \{([\s\S]*?)\n  \};/);
  if (!match) throw new Error("root plugin handlers object not found");
  return uniqueSorted([...match[1].matchAll(/\n\s{4}'([^']+)':/g)].map((m) => m[1]));
}

function readRootPluginHandlerActionsInOrder(source = readRootPluginSource()) {
  const match = source.match(/const handlers = \{([\s\S]*?)\n  \};/);
  if (!match) throw new Error("root plugin handlers object not found");
  return [...match[1].matchAll(/\n\s{4}'([^']+)':/g)].map((m) => m[1]);
}

function assertRootPluginHandlerParity(source = readRootPluginSource(), catalogActions = deriveCatalogFacts().actions) {
  assertSameMembers("root plugin handlers vs catalog", readRootPluginHandlerActions(source), catalogActions);
}

function loadModularHandlers() {
  return require(modularHandlersPath);
}

function readModularHandlerActions() {
  return uniqueSorted(Object.keys(loadModularHandlers()));
}

function readModularHandlerActionsInOrder() {
  return Object.keys(loadModularHandlers());
}

function assertModularHandlerParity(catalogActions = deriveCatalogFacts().actions) {
  assertSameMembers("modular handlers vs catalog", readModularHandlerActions(), catalogActions);
}

function assertRootPluginProjection(source = readRootPluginSource()) {
  const rootActions = readRootPluginHandlerActionsInOrder(source);
  const modularActions = readModularHandlerActionsInOrder();
  if (JSON.stringify(rootActions) !== JSON.stringify(modularActions)) {
    const max = Math.max(rootActions.length, modularActions.length);
    const firstMismatch = [];
    for (let i = 0; i < max && firstMismatch.length < 8; i += 1) {
      if (rootActions[i] !== modularActions[i]) {
        firstMismatch.push(`${i}: root=${rootActions[i] || "-"} modular=${modularActions[i] || "-"}`);
      }
    }
    throw new Error(`root plugin projection drift from modular handlers. ${firstMismatch.join("; ")}`);
  }
}

function assertDocsDoNotHardcodeCatalogSurface(docPaths = catalogDerivedDocPaths) {
  const violations = [];
  for (const filePath of docPaths) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const { label, pattern } of staleCatalogSurfacePatterns) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(rootDir, filePath)}: ${label}`);
      }
    }
  }
  if (violations.length) {
    throw new Error(`catalog-derived docs repeat stale contract facts:\n- ${violations.join("\n- ")}`);
  }
}

function checkCatalogContract() {
  const facts = validateCatalogShape(readCatalog());
  checkSyncedCatalogCopies();
  const rootSource = readRootPluginSource();
  assertRootPluginBrowserSafe(rootSource);
  assertRootPluginHandlerParity(rootSource, facts.actions);
  assertModularHandlerParity(facts.actions);
  assertRootPluginProjection(rootSource);
  assertDocsDoNotHardcodeCatalogSurface();
  return {
    toolCount: facts.tools.length,
    actionCount: facts.actions.length,
    resourceCount: facts.resources.length,
    syncedCatalogCount: syncedCatalogPaths.length,
    rootHandlerCount: readRootPluginHandlerActions(rootSource).length,
    modularHandlerCount: readModularHandlerActions().length,
  };
}

module.exports = {
  rootDir,
  canonicalCatalogPath,
  syncedCatalogPaths,
  rootPluginPath,
  catalogDerivedDocPaths,
  readCatalog,
  deriveCatalogFacts,
  validateCatalogShape,
  checkSyncedCatalogCopies,
  readRootPluginSource,
  stripTemplateLiteralBodies,
  assertRootPluginBrowserSafe,
  readRootPluginHandlerActions,
  readRootPluginHandlerActionsInOrder,
  assertRootPluginHandlerParity,
  loadModularHandlers,
  readModularHandlerActions,
  readModularHandlerActionsInOrder,
  assertModularHandlerParity,
  assertRootPluginProjection,
  assertDocsDoNotHardcodeCatalogSurface,
  assertSameMembers,
  checkCatalogContract,
};
