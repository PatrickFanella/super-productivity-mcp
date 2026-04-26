#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Use pre-built binary if present; fall back to go run.
if [[ -x "$ROOT_DIR/sp-mcp" ]]; then
  exec "$ROOT_DIR/sp-mcp"
else
  exec go run ./cmd/sp-mcp
fi
