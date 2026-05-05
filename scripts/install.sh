#!/usr/bin/env bash
# Install super-productivity-mcp: build the Go binary, set up the IPC data
# directory, install the skill, and print MCP client + SP plugin instructions.
#
# Usage:
#   scripts/install.sh                # default: ~/.local install
#   PREFIX=/opt/sp scripts/install.sh # override install prefix
#   SKIP_SKILL=1 scripts/install.sh   # skip skill install
#   SKIP_BUILD=1 scripts/install.sh   # use existing ./sp-mcp
#
# Honored env vars:
#   PREFIX          (default: $HOME/.local)
#   BIN_DIR         (default: $PREFIX/bin)
#   DATA_DIR        (default: $XDG_DATA_HOME/super-productivity-mcp or
#                    $HOME/.local/share/super-productivity-mcp)
#   SKILLS_DIR      (default: first existing of ~/.agents/skills,
#                    ~/.claude/skills, then ~/.agents/skills as fallback)
#   SKIP_BUILD, SKIP_SKILL, SKIP_DATA_DIR

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="${BIN_DIR:-$PREFIX/bin}"

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

# 1. Build the binary.
if [[ -z "${SKIP_BUILD:-}" ]]; then
  command -v go >/dev/null 2>&1 || fail "go is required to build sp-mcp"
  log "Building sp-mcp"
  go build -o "$ROOT_DIR/sp-mcp" ./cmd/sp-mcp
else
  [[ -x "$ROOT_DIR/sp-mcp" ]] || fail "SKIP_BUILD set but $ROOT_DIR/sp-mcp is missing"
  log "Skipping build (using existing sp-mcp)"
fi

# 2. Install the binary.
log "Installing binary to $BIN_DIR/sp-mcp"
mkdir -p "$BIN_DIR"
install -m 0755 "$ROOT_DIR/sp-mcp" "$BIN_DIR/sp-mcp"

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

# 5. Print client config + plugin instructions.
GREEN=$'\033[1;32m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
cat <<EOF

${GREEN}Install complete.${RESET}

  binary:   $BIN_DIR/sp-mcp
  data dir: $DATA_DIR
  skill:    ${SKILL_DEST:-<skipped>}

${BOLD}PATH check${RESET}
  Ensure $BIN_DIR is on your PATH. If not, add to your shell rc:
    export PATH="$BIN_DIR:\$PATH"

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

${BOLD}Super Productivity plugin${RESET}
  The JS bridge in plugin/bridge/ runs inside Super Productivity.
  Load it via Super Productivity's plugin loader, pointing at:
    $ROOT_DIR/plugin/bridge/plugin.js
  (The plugin reads $ROOT_DIR/plugin/bridge/tool-catalog.json automatically.)

${BOLD}Verify${RESET}
  $BIN_DIR/sp-mcp --version 2>/dev/null || echo "(no --version flag yet; smoke-test via your MCP client)"

EOF
