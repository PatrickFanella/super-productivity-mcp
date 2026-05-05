#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_SRC_DIR="$ROOT_DIR/plugin"
STAGE_DIR="$ROOT_DIR/dist/plugin/super-productivity-mcp"

VERSION="$({ sed -n 's/.*BinaryVersion = "\([^"]*\)".*/\1/p' "$ROOT_DIR/internal/version/version.go" || true; } | head -n1)"
VERSION="${VERSION:-0.1.0}"
ZIP_PATH="$ROOT_DIR/super-productivity-mcp-plugin-v${VERSION}.zip"

log() { printf "\033[1;34m==>\033[0m %s\n" "$*" >&2; }
fail() { printf "\033[1;31mxx\033[0m  %s\n" "$*" >&2; exit 1; }

[[ -f "$PLUGIN_SRC_DIR/manifest.json" ]] || fail "Missing plugin manifest at $PLUGIN_SRC_DIR/manifest.json"
[[ -f "$ROOT_DIR/plugin.js" ]] || fail "Missing plugin entrypoint at $ROOT_DIR/plugin.js"
[[ -d "$PLUGIN_SRC_DIR/bridge" ]] || fail "Missing plugin bridge directory at $PLUGIN_SRC_DIR/bridge"

log "Preparing plugin staging directory"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/plugin"

cp "$PLUGIN_SRC_DIR/manifest.json" "$STAGE_DIR/manifest.json"
cp "$ROOT_DIR/plugin.js" "$STAGE_DIR/plugin.js"
cp -R "$PLUGIN_SRC_DIR/bridge" "$STAGE_DIR/plugin/bridge"
find "$STAGE_DIR" -type f -name '*.test.js' -delete
python3 - <<'PY' "$STAGE_DIR/manifest.json" "$VERSION"
import json
import sys

manifest_path, version = sys.argv[1], sys.argv[2]
with open(manifest_path, 'r', encoding='utf-8') as f:
    manifest = json.load(f)
manifest['version'] = version
with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
PY

log "Creating plugin zip"
rm -f "$ZIP_PATH"
python3 - <<'PY' "$STAGE_DIR" "$ZIP_PATH"
import os
import sys
import zipfile

stage_dir, zip_path = sys.argv[1], sys.argv[2]
zip_dir = os.path.dirname(zip_path)
if zip_dir:
    os.makedirs(zip_dir, exist_ok=True)
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(stage_dir):
        dirs.sort()
        files.sort()
        for name in files:
            full_path = os.path.join(root, name)
            rel_path = os.path.relpath(full_path, stage_dir)
            zf.write(full_path, rel_path)
PY

log "Packaged plugin zip at $ZIP_PATH"
printf '%s\n' "$ZIP_PATH"