#!/usr/bin/env bash
# Builds the release files for VERSION into dist/release/:
#   super-productivity-mcp-VERSION-<os>-<arch>.tar.gz   sp-mcp and sp-quick-add
#   super-productivity-mcp-plugin-vVERSION.zip           the Super Productivity plugin
#   SHA256SUMS
# VERSION must match BinaryVersion in internal/version/version.go, which the
# plugin zip takes its version from. Tarballs are reproducible: sorted
# entries, fixed times and owners, gzip -n.
set -euo pipefail

version="${1:?usage: scripts/dist.sh VERSION}"
module=github.com/PatrickFanella/super-productivity-mcp
source_version=$(sed -n 's/.*BinaryVersion = "\([^"]*\)".*/\1/p' internal/version/version.go)
if [[ $source_version != "$version" ]]; then
  echo "dist: internal/version/version.go says $source_version, not $version" >&2
  exit 1
fi
commit=$(git rev-parse --short HEAD)
out=dist/release
rm -rf "$out"
mkdir -p "$out"

for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do
  os=${target%/*} arch=${target#*/}
  name="super-productivity-mcp-$version-$os-$arch"
  stage="$out/$name"
  mkdir -p "$stage"
  for cmd in sp-mcp sp-quick-add; do
    CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -buildvcs=false \
      -ldflags "-s -w -X $module/internal/version.BinaryVersion=$version -X $module/internal/version.Commit=$commit" \
      -o "$stage/$cmd" "./cmd/$cmd"
  done
  cp README.md LICENSE "$stage/"
  tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$out" -cf - "$name" | gzip -n9 > "$out/$name.tar.gz"
  rm -rf "$stage"
done

zip=$(bash scripts/package-plugin.sh)
mv "$zip" "$out/"
(cd "$out" && sha256sum -- *.tar.gz *.zip > SHA256SUMS)
cat "$out/SHA256SUMS"
