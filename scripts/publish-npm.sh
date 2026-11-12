#!/usr/bin/env bash
# Publishes the npm packages for VERSION from dist/release/ (scripts/dist.sh).
# In a GitHub Actions job with id-token: write, npm publishes through trusted
# publishing (OIDC). Elsewhere NODE_AUTH_TOKEN must be an npm token that may
# publish to SCOPE (default @subcult). A package version already on the
# registry is skipped, so a rerun is safe.
set -euo pipefail

version="${1:?usage: scripts/publish-npm.sh VERSION}"
scope="${SCOPE:-@subcult}"
if [[ -z ${NODE_AUTH_TOKEN:-} && -z ${ACTIONS_ID_TOKEN_REQUEST_URL:-} ]]; then
  echo "publish-npm: set NODE_AUTH_TOKEN, or run in GitHub Actions with id-token: write" >&2
  exit 1
fi

SCOPE="$scope" scripts/npm-packages.sh "$version"
npmrc=$(mktemp)
trap 'rm -f "$npmrc"' EXIT
# npm expands ${NODE_AUTH_TOKEN} itself, so the token is never written out.
# Without a token the file stays empty: an empty token line would shadow the
# OIDC token npm fetches for trusted publishing.
if [[ -n ${NODE_AUTH_TOKEN:-} ]]; then
  printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' > "$npmrc"
fi
# Platform packages first, so the launcher never names a missing version.
for dir in dist/npm/super-productivity-mcp-*/ dist/npm/super-productivity-mcp/; do
  name=$(node -p "require('./$dir/package.json').name")
  if npm view --userconfig "$npmrc" "$name@$version" version >/dev/null 2>&1; then
    echo "$name@$version is already published; skipping"
    continue
  fi
  npm publish --userconfig "$npmrc" --access public "$dir"
done
