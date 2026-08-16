#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="${SP_MCP_COMMAND:-}"
DATA_DIR="${SP_MCP_DATA_DIR:-${HOME}/.local/share/super-productivity-mcp}"

if [[ -z "$COMMAND" ]] && command -v sp-mcp >/dev/null 2>&1; then
  COMMAND="$(command -v sp-mcp)"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --command)
      COMMAND="${2:?--command requires a value}"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:?--data-dir requires a value}"
      shift 2
      ;;
    -h|--help)
      echo "usage: ./validate.sh [--command /path/to/sp-mcp] [--data-dir /path/to/ipc]"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$COMMAND" || ! -x "$COMMAND" ]]; then
  echo "Super Productivity MCP command is missing or not executable: ${COMMAND:-<unset>}" >&2
  exit 1
fi
if [[ ! -d "$DATA_DIR" ]]; then
  echo "Super Productivity MCP data directory is missing: $DATA_DIR" >&2
  exit 1
fi
if ! command -v deno >/dev/null 2>&1; then
  echo "deno is required to run validation scripts" >&2
  exit 1
fi

echo "Super Productivity MCP validation"
echo "command: $COMMAND"
echo "dataDir: $DATA_DIR"

deno run --allow-run --allow-env --allow-read \
  "$SKILL_DIR/scripts/protocol_smoke.ts" \
  --command "$COMMAND" \
  --catalog "$SKILL_DIR/data/tool-catalog.json"

deno run --allow-read --allow-env \
  "$SKILL_DIR/scripts/check_runtime_paths.ts" \
  --launcher "$COMMAND" \
  --data-dir "$DATA_DIR"

deno run --allow-read \
  "$SKILL_DIR/scripts/catalog_summary.ts" \
  "$SKILL_DIR/data/tool-catalog.json"

echo "Validation complete"
