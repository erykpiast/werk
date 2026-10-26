# Every task is a make target that calls the package.json script — see #lp-checks-scripts
# and #werk-devex-tasks. The rubric names the target; this file names the tool.
# `make` with no target lists the targets: each `## ` comment is the line it prints.

.DEFAULT_GOAL := help
.PHONY: help bun-version dev serve fix check test test-coverage typecheck lint e2e

BUN_WANT := $(shell cat .bun-version)

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 16

# Every target starts here. Bun ships breaking changes in minor releases (#werk-devex-toolver).
bun-version:
	@have=$$(bun --version 2>/dev/null); \
	if [ "$$have" != "$(BUN_WANT)" ]; then \
		echo "werk needs Bun $(BUN_WANT) (.bun-version), found: $${have:-none}."; \
		echo "Install it: curl -fsSL https://bun.sh/install | bash -s bun-v$(BUN_WANT)"; \
		exit 1; \
	fi

dev: bun-version ## Start werk with hot reload
	bun run dev

serve: bun-version ## Start werk without hot reload
	bun run serve

fix: bun-version ## Apply the linter's safe fixes
	bun run lint:fix

check: lint typecheck test-coverage e2e ## Run every check, fastest first

test: bun-version ## Unit tests
	CI=true bun run test

test-coverage: bun-version ## Unit tests with the coverage gate
	CI=true bun run test:coverage

typecheck: bun-version ## Type check
	bun run typecheck

lint: bun-version ## Lint
	bun run lint

e2e: bun-version ## Browser tests against a real server
	CI=true bun run e2e
