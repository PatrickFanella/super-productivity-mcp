#!/usr/bin/env bash
# Named install profiles for super-productivity-mcp.
#
# This script owns the profile-to-SKIP_* matrix. Use it from Make targets and
# tests. For custom shapes, call scripts/install.sh directly with explicit
# SKIP_* flags.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<EOF
Usage:
  scripts/install-profile.sh <profile> [--set KEY=VALUE ...] [-- <command...>]

Profiles:
  suite      Full suite install
  mcp        MCP binary + IPC data directory
  quick-add  quick-add binary + IPC data directory
  plugin     Plugin zip only
  skill      Agent skill bundle only

Options:
  --set KEY=VALUE  Override env after profile defaults are applied
  --               Run a custom command instead of scripts/install.sh
EOF
}

fail() {
  printf 'xx  %s\n' "$*" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

profile="$1"
shift

if [[ "$profile" == "-h" || "$profile" == "--help" ]]; then
  usage
  exit 0
fi

declare -a overrides=()
declare -a command=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --set)
      [[ $# -ge 2 ]] || fail "--set expects KEY=VALUE"
      overrides+=("$2")
      shift 2
      ;;
    --)
      shift
      command=("$@")
      break
      ;;
    *)
      fail "unexpected argument: $1"
      ;;
  esac
done

unset SKIP_MCP SKIP_QUICK_ADD SKIP_SKILL SKIP_DATA_DIR SKIP_PLUGIN_ZIP

case "$profile" in
  suite)
    ;;
  mcp)
    export SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1
    ;;
  quick-add)
    export SKIP_MCP=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1
    ;;
  plugin)
    export SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_DATA_DIR=1
    ;;
  skill)
    export SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_PLUGIN_ZIP=1 SKIP_DATA_DIR=1
    ;;
  *)
    fail "unknown profile: $profile"
    ;;
esac

for override in "${overrides[@]}"; do
  case "$override" in
    *=*)
      key="${override%%=*}"
      value="${override#*=}"
      [[ -n "$key" ]] || fail "--set expects KEY=VALUE"
      export "$key=$value"
      ;;
    *)
      fail "--set expects KEY=VALUE"
      ;;
  esac
done

if [[ ${#command[@]} -gt 0 ]]; then
  exec "${command[@]}"
else
  exec bash "$ROOT_DIR/scripts/install.sh"
fi
