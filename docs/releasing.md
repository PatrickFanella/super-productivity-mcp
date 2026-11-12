# Releasing

A release is a `v<version>` tag on `main`, pushed to GitHub. The version must match `BinaryVersion` in `internal/version/version.go`; the plugin's version comes from the same place when it is packaged, and `plugin/manifest.json` and the `pluginVersion` values in `plugin.js` and `plugin/bridge/actions/system.js` should say the same.

1. Bump those four places in a pull request and merge it.
2. Tag the merge commit and push the tag:

   ```bash
   git tag -a v0.2.0 -m "super-productivity-mcp 0.2.0" origin/main
   git push origin v0.2.0
   ```

`.github/workflows/release.yml` then:

- runs `make test` on the tagged commit;
- runs `scripts/dist.sh`, which builds `sp-mcp` and `sp-quick-add` for Linux and macOS on amd64 and arm64 into `super-productivity-mcp-<version>-<os>-<arch>.tar.gz`, packages `super-productivity-mcp-plugin-v<version>.zip`, and writes `SHA256SUMS`;
- creates the GitHub release with generated notes and attaches those files;
- runs `scripts/publish-npm.sh`, which publishes `@subcult/super-productivity-mcp-<os>-<cpu>` (one per platform, holding both binaries) and then `@subcult/super-productivity-mcp`, whose `sp-mcp`, `super-productivity-mcp` and `sp-quick-add` commands are small Node launchers for them. Versions already on npm are skipped.

To retry a release, run the workflow by hand with the tag.

## Secrets

| Secret | Holds |
|---|---|
| `NPM_TOKEN` (GitHub repository secret) | A granular npmjs.org token with read and write access to the `@subcult` packages and "Bypass two-factor authentication" enabled. Without it the npm step only warns. |

## Homebrew

`brew install subculture-collective/tap/super-productivity-mcp` builds from the release tag. After a release, update `url` and `sha256` in `Formula/super-productivity-mcp.rb` in [subculture-collective/homebrew-tap](https://github.com/subculture-collective/homebrew-tap); its CI builds, tests and audits the formula on macOS and Linux.
