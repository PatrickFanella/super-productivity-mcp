#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL_DIR="$ROOT_DIR/.agents/super-productivity-mcp"

COMMAND="${1:-$ROOT_DIR/scripts/run-mcp.sh}"
DATA_DIR="${SP_MCP_DATA_DIR:-$ROOT_DIR}"

if ! command -v deno >/dev/null 2>&1; then
  echo "❌ deno is required to run validation scripts." >&2
  exit 1
fi

echo "== Super Productivity MCP validation =="
echo "command: $COMMAND"
echo "dataDir: $DATA_DIR"

deno run --allow-run --allow-env --allow-read "$SKILL_DIR/scripts/protocol_smoke.ts" \
  --command "$COMMAND"

deno run --allow-read --allow-env "$SKILL_DIR/scripts/check_runtime_paths.ts" \
  --launcher "$ROOT_DIR/scripts/run-mcp.sh" \
  --data-dir "$DATA_DIR"

echo "✅ Validation complete"
