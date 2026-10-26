#!/bin/sh
# 69.5: run `make e2e` in a temporary copy of the checkout and inspect what it leaves.
set -u
CHECKOUT=$(cd "$(dirname "$0")/.." && pwd)
COPY=$(mktemp -d /tmp/werk-g695-XXXX)
git -C "$CHECKOUT" archive HEAD | tar -x -C "$COPY"
before=$(shasum "$COPY/e2e/fixtures/project/.werk/log.jsonl")
cd "$COPY" && make e2e > "$COPY/e2e.out" 2>&1; code=$?
echo "exit=$code"
tail -5 "$COPY/e2e.out"
echo "passed/failed lines: $(grep -cE '^\s+(✓|✘)' "$COPY/e2e.out")"
echo "tests ran: $(grep -E '^Running' "$COPY/e2e.out")"
echo "pngs: $(find "$COPY/test-results" -name '*.png' | wc -l)"
echo "png dirs: $(find "$COPY/test-results" -name '*.png' -exec dirname {} \; | sort -u | wc -l)"
after=$(shasum "$COPY/e2e/fixtures/project/.werk/log.jsonl")
[ "$before" = "$after" ] && echo "fixture log unchanged" || echo "fixture log CHANGED"
git -C "$COPY" status --short 2>/dev/null | head
echo "copy=$COPY"
