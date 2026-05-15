.PHONY: test test-go test-js test-e2e test-evals sync-catalogs check-catalogs install package-plugin

test: check-catalogs test-go test-js test-e2e test-evals

install:
	bash scripts/install.sh

package-plugin:
	bash scripts/package-plugin.sh

test-go:
	go test ./...

test-js:
	node --check quickadd-popup/popup.js
	node --test plugin/**/*.test.js plugin/bridge/**/*.test.js

test-e2e:
	go test ./test/e2e -v

test-evals:
	node scripts/check-evals.js

# Copy the canonical Go-side catalog to its synced JS- and skill-side
# locations. The Go file is the SSOT; never edit the copies directly.
sync-catalogs:
	cp internal/catalog/tools.json plugin/bridge/tool-catalog.json
	cp internal/catalog/tools.json skill/super-productivity-mcp/data/tool-catalog.json

# CI-safe drift check: fail if synced copies differ from the canonical catalog.
# Keep this read-only so local uncommitted synced copies can still pass.
check-catalogs:
	cmp -s internal/catalog/tools.json plugin/bridge/tool-catalog.json
	cmp -s internal/catalog/tools.json skill/super-productivity-mcp/data/tool-catalog.json
