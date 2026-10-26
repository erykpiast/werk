#!/bin/sh
# Held-out 69.5: run `make e2e` in a clean copy of the checkout, then check one PNG per test,
# a pass/fail line per spec, and that the fixture project's log did not change.
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
D=$(mktemp -d)/werk; mkdir -p "$D"
(cd "$SRC" && git archive HEAD) | tar -x -C "$D"
cd "$D"
before=$(shasum e2e/fixtures/project/.werk/log.jsonl)
make e2e > e2e.out 2>&1 || true
grep -cE '^\s+(✓|✘)' e2e.out | sed 's/^/result lines: /'
grep -E '[0-9]+ (passed|failed)' e2e.out
echo "test dirs: $(ls test-results | wc -l)"
for d in test-results/*/; do ls "$d" | grep -c png; done | sort | uniq -c | sed 's/^/pngs per dir: /'
[ "$before" = "$(shasum e2e/fixtures/project/.werk/log.jsonl)" ] && echo "fixture log unchanged"
