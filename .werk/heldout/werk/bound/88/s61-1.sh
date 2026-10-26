#!/bin/bash
# 61.1: fresh clone, empty first commit, five checks pass.
W=/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-qUpuCy
T=$(mktemp -d /tmp/s61-1.XXXXXX)
git clone -q "$W" "$T/werk" || exit 2
cd "$T/werk"
MAIN=$(git -C "$W" rev-parse main) || { echo "NO main ref"; exit 3; }
git checkout -q "$MAIN"
ROOTS=$(git rev-list --max-parents=0 "$MAIN")
echo "roots: $ROOTS"
FAIL=0
[ "$(echo "$ROOTS" | wc -l | tr -d ' ')" = 1 ] || { echo "FAIL: more than one root"; FAIL=1; }
FILES=$(git ls-tree -r --name-only "$ROOTS")
[ -z "$FILES" ] && echo "first commit holds no files" || { echo "FAIL: first commit files: $FILES"; FAIL=1; }
BAD=0
for c in $(git rev-list "$MAIN"); do git merge-base --is-ancestor "$ROOTS" "$c" || BAD=$((BAD+1)); done
echo "commits not descending from root: $BAD of $(git rev-list --count "$MAIN")"; [ $BAD = 0 ] || FAIL=1
for t in test test-coverage typecheck lint e2e; do
  make $t > "$T/$t.log" 2>&1; rc=$?
  echo "make $t -> $rc"; tail -5 "$T/$t.log"
  [ $rc = 0 ] || FAIL=1
done
# no browser spec: remove specs in the clone and run e2e again
find e2e -name '*.spec.ts' -delete
ls e2e
make e2e > "$T/e2e-nospec.log" 2>&1; rc=$?
echo "make e2e with no spec -> $rc"; tail -5 "$T/e2e-nospec.log"; [ $rc = 0 ] || FAIL=1
echo "TMP=$T"
echo "RESULT=$FAIL"
