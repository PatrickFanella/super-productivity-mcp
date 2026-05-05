.PHONY: test test-go test-js test-e2e sync-catalogs check-catalogs

test: check-catalogs test-go test-js test-e2e

test-go:
	go test ./...

test-js:
	node --test plugin/bridge/**/*.test.js

test-e2e:
	go test ./test/e2e -v

# Copy the canonical Go-side catalog to its synced JS- and skill-side
# locations. The Go file is the SSOT; never edit the copies directly.
sync-catalogs:
	cp internal/catalog/tools.json plugin/bridge/tool-catalog.json
	cp internal/catalog/tools.json skill/super-productivity-mcp/data/tool-catalog.json

# CI-safe drift check: run the sync, then fail if anything moved.
check-catalogs: sync-catalogs
	git diff --exit-code -- plugin/bridge/tool-catalog.json skill/super-productivity-mcp/data/tool-catalog.json
