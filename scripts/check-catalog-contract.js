#!/usr/bin/env node
const contract = require("./catalog-contract");

try {
  const result = contract.checkCatalogContract();
  console.log(
    `check-catalog-contract: ok (${result.toolCount} tools, ${result.actionCount} actions, ${result.resourceCount} resources, ${result.syncedCatalogCount} copies)`,
  );
} catch (error) {
  console.error(`check-catalog-contract: ${error.message}`);
  process.exit(1);
}
