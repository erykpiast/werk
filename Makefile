# Every task a person or an agent runs on werk is a target here.
# A target's description is the text after "##" on its line.

PINNED_BUN := $(shell cat .bun-version)
STAMP := node_modules/.install-stamp

.DEFAULT_GOAL := help
.PHONY: help bun-version install lint lint-fix typecheck test test-coverage e2e check dev

help: bun-version ## List every target with its description
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | \
		sed -E 's/^([a-z0-9-]+):.*## (.*)$$/\1\t\2/' | \
		awk -F'\t' '{ printf "  %-14s %s\n", $$1, $$2 }'

bun-version:
	@installed="$$(bun --version 2>/dev/null)"; \
	if [ "$$installed" != "$(PINNED_BUN)" ]; then \
		echo "werk: wrong Bun version." >&2; \
		echo "werk: installed: $${installed:-none}" >&2; \
		echo "werk: pinned:    $(PINNED_BUN) (file .bun-version)" >&2; \
		echo "werk: install it with: curl -fsSL https://bun.sh/install | bash -s \"bun-v$(PINNED_BUN)\"" >&2; \
		exit 1; \
	fi

# Installs the locked packages when the package file or the lock file changed.
# --frozen-lockfile fails instead of changing the lock.
$(STAMP): package.json bun.lock
	bun install --frozen-lockfile
	@touch $(STAMP)

install: bun-version $(STAMP) ## Install the locked packages when they changed

lint: bun-version $(STAMP) ## Lint and format-check all code with Biome
	bun run lint

lint-fix: bun-version $(STAMP) ## Apply Biome's safe fixes
	bun run lint:fix

typecheck: bun-version $(STAMP) ## Type-check all code with TypeScript 7 in strict mode
	bun run typecheck

test: bun-version $(STAMP) ## Run the unit tests on four parallel workers
	bun run test

test-coverage: bun-version $(STAMP) ## Run the unit tests with coverage, then the 90% gate on the pure files
	bun run test:coverage

e2e: bun-version $(STAMP) ## Run the Playwright tests in Chromium, and install the browser when it is missing
	bunx playwright install chromium
	bun run e2e

check: bun-version $(STAMP) ## Run every check in the merge loop's order
	$(MAKE) lint
	$(MAKE) typecheck
	$(MAKE) test
	$(MAKE) test-coverage
	$(MAKE) e2e

dev: bun-version $(STAMP) ## Start the dev server: Vite serves the client, and a client change reloads the page
	bun run dev
