# Every task on werk is a make target that calls one script in package.json (#werk-devex-tasks,
# #lp-checks-scripts). The target names the task; the script holds the tool and its flags.
# `make` with no target prints the list: each target's `##` comment is its line in the list.

.DEFAULT_GOAL := help
.PHONY: help bun-version dev lint typecheck test test-coverage e2e check fix build

BUN_PINNED := $(shell cat .bun-version)
INSTALLED := node_modules/.werk-installed

help: bun-version ## Print every target with its description
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/^([a-z0-9-]+):.*## /\1\t/' | expand -t 16

# Every target stops first on a Bun version other than the pinned one (#werk-devex-toolver).
bun-version:
	@found=$$(bun --version 2>/dev/null); \
	if [ "$$found" != "$(BUN_PINNED)" ]; then \
		echo "werk needs Bun $(BUN_PINNED), the version in .bun-version. Installed: $${found:-no Bun found}." >&2; \
		echo "Install the pinned version: curl -fsSL https://bun.sh/install | bash -s bun-v$(BUN_PINNED)" >&2; \
		exit 1; \
	fi

# The locked packages install again only when the package file or the lockfile changes,
# so a fresh clone and a working checkout give the same verdict (#werk-test-fresh-tree).
$(INSTALLED): package.json bun.lock | bun-version
	bun install --frozen-lockfile
	@touch $@

dev: bun-version $(INSTALLED) ## Start werk in development, with hot reload
	bun run dev

lint: bun-version $(INSTALLED) ## Lint and format check with Biome
	bun run lint

typecheck: bun-version $(INSTALLED) ## Type check with TypeScript 7, no output
	bun run typecheck

test: bun-version $(INSTALLED) ## Unit tests under bun test, on four workers
	bun run test

test-coverage: bun-version $(INSTALLED) ## Each listed pure file against 90% of lines, by its own test file
	bun run test:coverage

e2e: bun-version $(INSTALLED) ## Browser tests under Playwright
	bun run e2e

check: lint typecheck test test-coverage e2e ## Every check, in the order the merge loop runs them

fix: bun-version $(INSTALLED) ## Apply the safe fixes of the linter and the formatter
	bun run fix

build: bun-version $(INSTALLED) ## Build the werk executable
	bun run build
