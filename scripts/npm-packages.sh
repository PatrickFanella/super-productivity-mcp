#!/usr/bin/env bash
# Builds the npm packages for VERSION from the tarballs in dist/release/
# (scripts/dist.sh), into dist/npm/:
#   super-productivity-mcp-<os>-<cpu>/   one per platform, with both binaries
#   super-productivity-mcp/              launchers, with the four as optional dependencies
# npm installs only the platform package whose "os" and "cpu" match.
# SCOPE is the npm scope that owns the packages (default @subcult).
set -euo pipefail

version="${1:?usage: scripts/npm-packages.sh VERSION}"
scope="${SCOPE:-@subcult}"
base=super-productivity-mcp
out=dist/npm
rm -rf "$out"
mkdir -p "$out"

common() {
  cat <<JSON
  "version": "$version",
  "license": "MIT",
  "homepage": "https://github.com/subculture-collective/super-productivity-mcp",
  "repository": { "type": "git", "url": "git+https://github.com/subculture-collective/super-productivity-mcp.git" },
  "bugs": "https://github.com/subculture-collective/super-productivity-mcp/issues"
JSON
}

deps=""
for target in linux/amd64/x64 linux/arm64/arm64 darwin/amd64/x64 darwin/arm64/arm64; do
  IFS=/ read -r os goarch cpu <<<"$target"
  tarball="dist/release/$base-$version-$os-$goarch.tar.gz"
  [[ -f $tarball ]] || { echo "npm-packages: $tarball is missing; run scripts/dist.sh first" >&2; exit 1; }
  name="$base-$os-$cpu"
  dir="$out/$name"
  mkdir -p "$dir/bin"
  tar -xzf "$tarball" -C "$dir" --strip-components=1
  mv "$dir/sp-mcp" "$dir/sp-quick-add" "$dir/bin/"
  chmod 0755 "$dir/bin/sp-mcp" "$dir/bin/sp-quick-add"
  cat > "$dir/package.json" <<JSON
{
  "name": "$scope/$name",
  "description": "The sp-mcp and sp-quick-add binaries for $os on $cpu. Install $scope/$base instead.",
$(common),
  "os": ["$os"],
  "cpu": ["$cpu"],
  "files": ["bin/sp-mcp", "bin/sp-quick-add", "README.md", "LICENSE"]
}
JSON
  deps+="${deps:+,
}    \"$scope/$name\": \"$version\""
done

dir="$out/$base"
mkdir -p "$dir/bin"
sed "s|@SCOPE@|$scope|" packaging/npm/run.js > "$dir/bin/run.js"
for cmd in sp-mcp sp-quick-add; do
  printf '#!/usr/bin/env node\n"use strict";\nrequire("./run.js")("%s");\n' "$cmd" > "$dir/bin/$cmd.js"
  chmod 0755 "$dir/bin/$cmd.js"
done
cp README.md LICENSE "$dir/"
cat > "$dir/package.json" <<JSON
{
  "name": "$scope/$base",
  "description": "MCP server that lets AI clients read and change your tasks in Super Productivity",
$(common),
  "keywords": ["mcp", "model-context-protocol", "super-productivity", "tasks", "productivity"],
  "bin": {
    "super-productivity-mcp": "bin/sp-mcp.js",
    "sp-mcp": "bin/sp-mcp.js",
    "sp-quick-add": "bin/sp-quick-add.js"
  },
  "files": ["bin/", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "optionalDependencies": {
$deps
  }
}
JSON
find "$out" -name package.json | sort
