#!/bin/sh
# Runs the held-out tests on a copy of the committed checkout, so the checkout gets no
# node_modules and no test output. Usage: sh .werk-heldout/run.sh (from the repository root).
set -e
SRC=$(pwd)
COPY=${HELDOUT_COPY:-/tmp/werk-heldout-copy}
mkdir -p "$COPY"
git archive HEAD | tar -x -C "$COPY"
mkdir -p "$COPY/.werk-heldout"
cp .werk-heldout/*.ts "$COPY/.werk-heldout/"
make -C "$COPY" node_modules/.werk-installed
cd "$COPY"
bun test ./.werk-heldout/cli.test.ts --timeout=30000 || true
npx playwright test -c .werk-heldout/playwright.config.ts || true
cd .werk-heldout && HELDOUT_SRC="$SRC" bun test ./repo.test.ts --timeout=1200000 || true
