#!/usr/bin/env bash
# Install super-productivity-mcp: build the Go binary, set up the IPC data
# directory, install the skill, package the SP plugin zip, and print MCP
# client + plugin instructions.
#
# Usage:
#   scripts/install.sh                    # full suite: MCP, quick-add, skill, plugin zip
#   PREFIX=/opt/sp scripts/install.sh     # override install prefix
#   BUILD_DIR=/tmp/build scripts/install.sh  # build binaries outside the repo root
#   SKIP_MCP=1 scripts/install.sh         # skip MCP binary build/install
#   SKIP_QUICK_ADD=1 scripts/install.sh   # skip quick-add binary and popup assets
#   SKIP_SKILL=1 scripts/install.sh       # skip skill install
#   SKIP_PLUGIN_ZIP=1 scripts/install.sh  # skip plugin zip packaging
#   SKIP_BUILD=1 scripts/install.sh       # use existing requested binaries
#
# Honored env vars:
#   PREFIX          (default: $HOME/.local)
#   BIN_DIR         (default: $PREFIX/bin)
#   SHARE_DIR       (default: $PREFIX/share/super-productivity-mcp)
#   BUILD_DIR       (default: $ROOT_DIR)
#   DATA_DIR        (default: $XDG_DATA_HOME/super-productivity-mcp or
#                    $HOME/.local/share/super-productivity-mcp)
#   SKILLS_DIR      (default: first existing of ~/.agents/skills,
#                    ~/.claude/skills, then ~/.agents/skills as fallback)
#   SKIP_BUILD, SKIP_MCP, SKIP_QUICK_ADD, SKIP_SKILL, SKIP_DATA_DIR,
#   SKIP_PLUGIN_ZIP

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="${BIN_DIR:-$PREFIX/bin}"
SHARE_DIR="${SHARE_DIR:-$PREFIX/share/super-productivity-mcp}"
BUILD_DIR="${BUILD_DIR:-$ROOT_DIR}"

if [[ -z "${DATA_DIR:-}" ]]; then
  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    DATA_DIR="$XDG_DATA_HOME/super-productivity-mcp"
  else
    DATA_DIR="$HOME/.local/share/super-productivity-mcp"
  fi
fi

if [[ -z "${SKILLS_DIR:-}" ]]; then
  for candidate in "$HOME/.agents/skills" "$HOME/.claude/skills"; do
    if [[ -d "$candidate" ]]; then
      SKILLS_DIR="$candidate"
      break
    fi
  done
  SKILLS_DIR="${SKILLS_DIR:-$HOME/.agents/skills}"
fi

log()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!!\033[0m  %s\n" "$*" >&2; }
fail() { printf "\033[1;31mxx\033[0m  %s\n" "$*" >&2; exit 1; }

# 1. Build the requested binaries.
if [[ -z "${SKIP_BUILD:-}" ]]; then
  if [[ -z "${SKIP_MCP:-}" || -z "${SKIP_QUICK_ADD:-}" ]]; then
    mkdir -p "$BUILD_DIR"
  fi

  if [[ -z "${SKIP_MCP:-}" ]]; then
    command -v go >/dev/null 2>&1 || fail "go is required to build sp-mcp"
    log "Building sp-mcp"
    go build -o "$BUILD_DIR/sp-mcp" ./cmd/sp-mcp
  fi

  if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
    command -v go >/dev/null 2>&1 || fail "go is required to build sp-quick-add"
    log "Building sp-quick-add"
    go build -o "$BUILD_DIR/sp-quick-add" ./cmd/sp-quick-add
  fi
else
  if [[ -z "${SKIP_MCP:-}" ]]; then
    [[ -x "$BUILD_DIR/sp-mcp" ]] || fail "SKIP_BUILD set but $BUILD_DIR/sp-mcp is missing"
  fi
  if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
    [[ -x "$BUILD_DIR/sp-quick-add" ]] || fail "SKIP_BUILD set but $BUILD_DIR/sp-quick-add is missing"
  fi
  log "Skipping build (using existing requested binaries)"
fi

# 2. Install the requested binaries and assets.
if [[ -z "${SKIP_MCP:-}" || -z "${SKIP_QUICK_ADD:-}" ]]; then
  mkdir -p "$BIN_DIR"
fi

if [[ -z "${SKIP_MCP:-}" ]]; then
  log "Installing binary to $BIN_DIR/sp-mcp"
  install -m 0755 "$BUILD_DIR/sp-mcp" "$BIN_DIR/sp-mcp"
fi

if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
  log "Installing binary to $BIN_DIR/sp-quick-add"
  install -m 0755 "$BUILD_DIR/sp-quick-add" "$BIN_DIR/sp-quick-add"

  log "Installing quick-add popup assets to $SHARE_DIR/quickadd-popup"
  mkdir -p "$SHARE_DIR/quickadd-popup"
  install -m 0755 "$ROOT_DIR/quickadd-popup/popup.js" "$SHARE_DIR/quickadd-popup/popup.js"
  install -m 0644 "$ROOT_DIR/quickadd-popup/style.css" "$SHARE_DIR/quickadd-popup/style.css"
fi

# 3. Create the IPC data directory.
if [[ -z "${SKIP_DATA_DIR:-}" ]]; then
  log "Preparing data directory $DATA_DIR"
  mkdir -p \
    "$DATA_DIR/inbox" \
    "$DATA_DIR/processing" \
    "$DATA_DIR/outbox" \
    "$DATA_DIR/events" \
    "$DATA_DIR/deadletter"
fi

# 4. Install the skill snapshot.
if [[ -z "${SKIP_SKILL:-}" ]]; then
  SKILL_DEST="$SKILLS_DIR/super-productivity-mcp"
  log "Installing skill to $SKILL_DEST"
  mkdir -p "$SKILL_DEST"
  # Mirror the skill folder. Use rsync if present for cleaner deletes; fall
  # back to cp -R.
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$ROOT_DIR/skill/super-productivity-mcp/" "$SKILL_DEST/"
  else
    rm -rf "$SKILL_DEST"
    mkdir -p "$SKILL_DEST"
    cp -R "$ROOT_DIR/skill/super-productivity-mcp/." "$SKILL_DEST/"
  fi
fi

# 5. Package the Super Productivity plugin zip.
if [[ -z "${SKIP_PLUGIN_ZIP:-}" ]]; then
  log "Packaging Super Productivity plugin zip"
  PLUGIN_ZIP="$(bash "$ROOT_DIR/scripts/package-plugin.sh")"
else
  PLUGIN_ZIP="<skipped>"
fi

MCP_SUMMARY="<skipped>"
QUICK_ADD_SUMMARY="<skipped>"
POPUP_SUMMARY="<skipped>"
DATA_DIR_SUMMARY="$DATA_DIR"
SKILL_SUMMARY="${SKILL_DEST:-<skipped>}"

if [[ -n "${SKIP_DATA_DIR:-}" ]]; then
  DATA_DIR_SUMMARY="<skipped>"
fi
if [[ -z "${SKIP_MCP:-}" ]]; then
  MCP_SUMMARY="$BIN_DIR/sp-mcp"
fi
if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
  QUICK_ADD_SUMMARY="$BIN_DIR/sp-quick-add"
  POPUP_SUMMARY="$SHARE_DIR/quickadd-popup"
fi

# 6. Print install summary + profile-specific follow-up instructions.
GREEN=$'\033[1;32m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
cat <<EOF

${GREEN}Install complete.${RESET}

  mcp:       $MCP_SUMMARY
  quick add: $QUICK_ADD_SUMMARY
  popup:     $POPUP_SUMMARY
  data dir:  $DATA_DIR_SUMMARY
  skill:     $SKILL_SUMMARY
  plugin:    $PLUGIN_ZIP

EOF

if [[ -z "${SKIP_MCP:-}" || -z "${SKIP_QUICK_ADD:-}" ]]; then
  cat <<EOF

${BOLD}PATH check${RESET}
  Ensure $BIN_DIR is on your PATH. If not, add to your shell rc:
    export PATH="$BIN_DIR:\$PATH"

EOF
fi

if [[ -z "${SKIP_MCP:-}" ]]; then
  cat <<EOF
${BOLD}MCP client config${RESET} (drop into your client's mcp.json)
{
  "mcpServers": {
    "super-productivity": {
      "command": "$BIN_DIR/sp-mcp",
      "env": {
        "SP_MCP_DATA_DIR": "$DATA_DIR",
        "SP_MCP_LOG_LEVEL": "info"
      }
    }
  }
}

EOF
fi

if [[ -z "${SKIP_PLUGIN_ZIP:-}" ]]; then
  cat <<EOF
${BOLD}Super Productivity plugin${RESET}
  Upload the packaged plugin zip via Settings -> Plugins -> Upload Plugin:
    $PLUGIN_ZIP
  For development/debugging, the packaged folder is also available under:
    $ROOT_DIR/dist/plugin/super-productivity-mcp

EOF
elif [[ -z "${SKIP_MCP:-}" || -z "${SKIP_QUICK_ADD:-}" ]]; then
  cat <<EOF
${BOLD}Super Productivity plugin${RESET}
  Plugin packaging was skipped. MCP and quick-add require a compatible Super Productivity plugin bridge to be installed and enabled.

EOF
fi

if [[ -z "${SKIP_MCP:-}" || -z "${SKIP_QUICK_ADD:-}" ]]; then
  printf '%sVerify%s\n' "$BOLD" "$RESET"
  if [[ -z "${SKIP_MCP:-}" ]]; then
    printf '  MCP smoke:       %s --version 2>/dev/null || echo "(no --version flag yet; smoke-test via your MCP client)"\n' "$MCP_SUMMARY"
  fi
  if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
    printf '  Quick-add smoke: %s --dry-run --title "Smoke quick add @today"\n' "$QUICK_ADD_SUMMARY"
  fi
  printf '\n'
fi

if [[ -z "${SKIP_QUICK_ADD:-}" ]]; then
  cat <<EOF
${BOLD}Omarchy / Hyprland quick add${RESET}
  Quick-add requires the Super Productivity plugin bridge to be installed and enabled.
  Add this to ~/.config/hypr/bindings.conf:
    bindd = SUPER SHIFT, T, Super Productivity quick add, exec, uwsm-app -- $BIN_DIR/sp-quick-add

EOF
fi
