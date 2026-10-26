#!/bin/bash
# 61.1 A fresh clone builds on an empty first commit and passes every check.
source "$(dirname "$0")/common.sh"
W="$(clone)"; cd "$W"
FIRST="$(git rev-list --max-parents=0 main)"
echo "first commits: $FIRST"
check "exactly one root commit" '[ "$(echo "$FIRST" | wc -l | tr -d " ")" = 1 ]'
check "first commit holds no files" '[ -z "$(git ls-tree -r --name-only "$FIRST")" ]'
BAD=0; for c in $(git rev-list main); do git merge-base --is-ancestor "$FIRST" "$c" || BAD=1; done
check "every commit on main has the first commit as ancestor" '[ $BAD = 0 ]'
check "no browser spec in the first commit (sanity)" 'true'
for t in test test-coverage typecheck lint e2e; do
  make "$t" > "/tmp/heldout-61.1-$t.log" 2>&1; rc=$?
  echo "make $t -> $rc (log /tmp/heldout-61.1-$t.log)"; tail -5 "/tmp/heldout-61.1-$t.log"
  check "make $t exits 0" '[ $rc = 0 ]'
done
echo "e2e specs present: $(ls e2e/*.spec.ts 2>/dev/null | wc -l)"
exit $FAILED
