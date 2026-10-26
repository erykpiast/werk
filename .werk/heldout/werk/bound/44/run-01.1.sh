#!/bin/bash
# Held-out step 01.1. Runs in a copy of the checkout, so the checkout is not changed.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)/werk"
rsync -a --exclude .git --exclude .werk-heldout --exclude node_modules "$ROOT/" "$WORK/"
cd "$WORK" || exit 9
fail() { echo "FAIL: $*"; exit 1; }
make test > t1.log 2>&1; c1=$?
cat t1.log | tail -15
[ $c1 -eq 0 ] || fail "make test exit $c1"
grep -Eiq "coverage|% (lines|funcs)" t1.log && fail "make test output mentions coverage"
echo "OK: make test passes, no coverage output"
make test-coverage > c1.log 2>&1; c2=$?
cat c1.log
[ $c2 -eq 0 ] || fail "make test-coverage exit $c2"
for f in $(grep -v '^#' pure-files.txt | grep -v '^$'); do
  grep -E "[0-9]+(\.[0-9]+)?%.*$f" c1.log >/dev/null || fail "no percentage line for $f"
done
echo "OK: one line per pure file, coverage passes"
rm web/md.test.ts
make test-coverage > c2.log 2>&1; c3=$?
cat c2.log
[ $c3 -ne 0 ] || fail "coverage passed after deleting web/md.test.ts"
grep -E "(^|[^0-9.])0(\.0+)?%.*web/md.ts" c2.log >/dev/null || fail "no 0% line for web/md.ts"
grep -q "web/md.test.ts" c2.log || fail "output does not name web/md.test.ts"
echo "OK: coverage fails, 0% for web/md.ts, names web/md.test.ts"
make test > t2.log 2>&1; c4=$?
tail -8 t2.log
[ $c4 -eq 0 ] || fail "make test exit $c4 after deletion"
grep -Eiq "coverage" t2.log && fail "make test mentions coverage after deletion"
echo "PASS 01.1"
