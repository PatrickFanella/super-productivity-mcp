// Aggregates action handlers and validates they match the canonical tool
// catalog at module-load time. The catalog is the single source of truth for
// the action surface; drift between handlers and catalog is a load-time
// failure, not a runtime mystery.

const catalog = require("../tool-catalog.json");

const handlers = {
  ...require("./task"),
  ...require("./project"),
  ...require("./tag"),
  ...require("./system"),
};

const catalogActions = catalog.tools.map((t) => t.action);
const missing = catalogActions.filter((a) => typeof handlers[a] !== "function");
if (missing.length) {
  throw new Error(
    `Tool catalog declares actions without handlers: ${missing.join(", ")}`,
  );
}

const orphans = Object.keys(handlers).filter(
  (a) => !catalogActions.includes(a),
);
if (orphans.length) {
  throw new Error(
    `Action handlers not declared in tool catalog: ${orphans.join(", ")}`,
  );
}

module.exports = handlers;
