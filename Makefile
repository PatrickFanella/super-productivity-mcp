.PHONY: test test-go test-js test-e2e test-evals generate-docs check-docs verify-release sync-catalogs check-catalogs install install-suite install-mcp install-quick-add install-plugin install-skill package-plugin test-install-profiles

test: check-catalogs check-docs test-go test-js test-e2e test-evals

verify-release: test test-install-profiles package-plugin

install: install-suite

install-suite:
	bash scripts/install.sh

install-mcp:
	SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1 bash scripts/install.sh

install-quick-add:
	SKIP_MCP=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1 bash scripts/install.sh

install-plugin:
	SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_DATA_DIR=1 bash scripts/install.sh

install-skill:
	SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_PLUGIN_ZIP=1 SKIP_DATA_DIR=1 bash scripts/install.sh

package-plugin:
	bash scripts/package-plugin.sh

test-install-profiles:
	@set -eu; \
	TMP_BASE="$$(if [ -d /tmp/opencode ]; then printf '%s' /tmp/opencode; else printf '%s' /tmp; fi)"; \
	TMP_ROOT="$$TMP_BASE/sp-mcp-install-profiles"; \
	rm -rf "$$TMP_ROOT"; \
	mkdir -p "$$TMP_ROOT"; \
	run_install() { \
		profile="$$1"; \
		shift; \
		prefix="$$TMP_ROOT/$$profile/prefix"; \
		build="$$TMP_ROOT/$$profile/build"; \
		data="$$TMP_ROOT/$$profile/data"; \
		env \
			-u BIN_DIR \
			-u SHARE_DIR \
			-u SKIP_BUILD \
			-u SKIP_MCP \
			-u SKIP_QUICK_ADD \
			-u SKIP_SKILL \
			-u SKIP_DATA_DIR \
			-u SKIP_PLUGIN_ZIP \
			PREFIX="$$prefix" \
			BIN_DIR="$$prefix/bin" \
			SHARE_DIR="$$prefix/share/super-productivity-mcp" \
			BUILD_DIR="$$build" \
			DATA_DIR="$$data" \
			"$$@" \
			bash scripts/install.sh; \
	}; \
	run_install full SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1; \
	test -x "$$TMP_ROOT/full/prefix/bin/sp-mcp"; \
	test -x "$$TMP_ROOT/full/prefix/bin/sp-quick-add"; \
	test -f "$$TMP_ROOT/full/prefix/share/super-productivity-mcp/quickadd-popup/popup.js"; \
	test -d "$$TMP_ROOT/full/data/inbox"; \
	run_install mcp SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1; \
	test -x "$$TMP_ROOT/mcp/prefix/bin/sp-mcp"; \
	test ! -e "$$TMP_ROOT/mcp/prefix/bin/sp-quick-add"; \
	test ! -e "$$TMP_ROOT/mcp/prefix/share/super-productivity-mcp/quickadd-popup/popup.js"; \
	test -d "$$TMP_ROOT/mcp/data/inbox"; \
	run_install quick-add SKIP_MCP=1 SKIP_SKILL=1 SKIP_PLUGIN_ZIP=1; \
	test ! -e "$$TMP_ROOT/quick-add/prefix/bin/sp-mcp"; \
	test -x "$$TMP_ROOT/quick-add/prefix/bin/sp-quick-add"; \
	test -f "$$TMP_ROOT/quick-add/prefix/share/super-productivity-mcp/quickadd-popup/popup.js"; \
	test -d "$$TMP_ROOT/quick-add/data/inbox"; \
	run_install skill SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_PLUGIN_ZIP=1 SKIP_DATA_DIR=1 SKILLS_DIR="$$TMP_ROOT/skill/skills"; \
	test -f "$$TMP_ROOT/skill/skills/super-productivity-mcp/SKILL.md"; \
	test ! -e "$$TMP_ROOT/skill/prefix/bin"; \
	run_install plugin SKIP_MCP=1 SKIP_QUICK_ADD=1 SKIP_SKILL=1 SKIP_DATA_DIR=1; \
	set -- super-productivity-mcp-plugin-v*.zip; \
	test -f "$$1"; \
	test -f dist/plugin/super-productivity-mcp/manifest.json; \
	test ! -e "$$TMP_ROOT/plugin/prefix/bin"

test-go:
	go test ./...

test-js:
	node --check quickadd-popup/popup.js
	node --test plugin/**/*.test.js plugin/bridge/**/*.test.js

test-e2e:
	go test ./test/e2e -v

test-evals:
	node scripts/check-evals.js

generate-docs:
	node scripts/generate-catalog-docs.js

check-docs:
	node scripts/generate-catalog-docs.js --check

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
