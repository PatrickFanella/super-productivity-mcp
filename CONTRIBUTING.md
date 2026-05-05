# Contributing

Thank you for your interest in contributing! Here's everything you need to get started.

## Development setup

**Prerequisites:** Go 1.22+, Node.js 18+

```bash
git clone https://github.com/PatrickFanella/super-productivity-mcp.git
cd super-productivity-mcp
go build -o sp-mcp ./cmd/sp-mcp
```

## Running tests

```bash
make test           # full suite: catalog check + Go + JS + E2E
go test ./...       # Go unit tests
node --test plugin/bridge/**/*.test.js  # JS bridge tests
go test ./test/e2e -v                   # E2E tests
```

## Keeping the tool catalog in sync

`internal/catalog/tools.json` is the single source of truth for the MCP tool surface. After editing it, run:

```bash
make sync-catalogs
```

CI will fail if the copies in `plugin/bridge/tool-catalog.json` and `skill/super-productivity-mcp/data/tool-catalog.json` are out of date.

## Pull requests

- Keep changes focused — one concern per PR.
- Add or update tests for new behaviour.
- Run `make test` before opening a PR; CI runs the same checks.
- Write a clear description explaining *what* changed and *why*.

## Reporting bugs

Open a [GitHub Issue](https://github.com/PatrickFanella/super-productivity-mcp/issues/new) with:
- Steps to reproduce
- Expected behaviour
- Actual behaviour (including any error output)
- Versions: Go, Node.js, Super Productivity, OS

## Security

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
