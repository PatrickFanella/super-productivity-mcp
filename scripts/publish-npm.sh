#!/usr/bin/env bash
# Publishes the npm packages for VERSION from dist/release/ (scripts/dist.sh).
# NODE_AUTH_TOKEN is an npm token that may publish to SCOPE (default
# @subcult) and bypasses two-factor authentication. A package version already
# on the registry is skipped, so a rerun is safe.
set -euo pipefail

version="${1:?usage: scripts/publish-npm.sh VERSION}"
scope="${SCOPE:-@subcult}"
: "${NODE_AUTH_TOKEN:?NODE_AUTH_TOKEN is not set}"

SCOPE="$scope" scripts/npm-packages.sh "$version"
npmrc=$(mktemp)
trap 'rm -f "$npmrc"' EXIT
# npm expands ${NODE_AUTH_TOKEN} itself, so the token is never written out.
printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' > "$npmrc"
# Platform packages first, so the launcher never names a missing version.
for dir in dist/npm/super-productivity-mcp-*/ dist/npm/super-productivity-mcp/; do
  name=$(node -p "require('./$dir/package.json').name")
  if npm view --userconfig "$npmrc" "$name@$version" version >/dev/null 2>&1; then
    echo "$name@$version is already published; skipping"
    continue
  fi
  npm publish --userconfig "$npmrc" --access public "$dir"
done
