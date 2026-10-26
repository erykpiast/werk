#!/bin/sh
# Runs the held-out tests in a temp clone of this checkout, so the checkout itself stays unchanged.
# Usage: .werk-heldout/run.sh [bun-test-file...]   (env E2E=1 also runs the browser specs)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/.." && pwd)
CLONE=${WERK_HO_CLONE:-/tmp/werk-ho-product}
if [ ! -d "$CLONE/.git" ]; then
  git clone -q "$SRC" "$CLONE"
  git -C "$CLONE" checkout -q "$(git -C "$SRC" rev-parse HEAD)"
  (cd "$CLONE" && bun install --frozen-lockfile >/dev/null)
fi
rm -rf "$CLONE/.werk-heldout"
cp -R "$HERE" "$CLONE/.werk-heldout"
cd "$CLONE"
export WERK_ROOT="$CLONE"
export WERK_SRC="$SRC"
if [ "$#" -gt 0 ]; then
  CI=true bun test --timeout 900000 "$@"
fi
if [ -n "$E2E" ]; then
  CI=true bunx playwright test -c .werk-heldout/playwright.config.ts
fi
