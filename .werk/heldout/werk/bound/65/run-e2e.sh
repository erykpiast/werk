#!/bin/sh
# Runs the held-out browser specs in a temporary clone, so the checkout gets no node_modules.
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d /tmp/werk-heldout-e2e-XXXX)
git clone --quiet --no-local "$SRC" "$TMP/werk"
cd "$TMP/werk"
git checkout --quiet "$(git -C "$SRC" rev-parse HEAD)"
cp -R "$SRC/.werk-heldout" .werk-heldout
bun install --frozen-lockfile >/dev/null 2>&1
bunx playwright install chromium >/dev/null 2>&1
cd .werk-heldout
CI=true ../node_modules/.bin/playwright test -c playwright.config.ts "$@" || code=$?
echo "results in $TMP/werk/.werk-heldout/test-results"
exit ${code:-0}
