#!/bin/sh
# Runs the held-out browser specs in a copy of this checkout that has its dependencies
# installed, so the checkout itself gains no node_modules. Usage: run-e2e.sh <copy-dir> [filter]
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
E=$1; shift
rsync -a --delete "$SRC/.werk-heldout/" "$E/.werk-heldout/"
cd "$E" && CI=true bunx playwright test -c .werk-heldout/playwright.config.ts "$@"
