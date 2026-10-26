#!/bin/bash
# 61.3: make test passes with no claude on PATH, the CLI tests use temp projects, the tree stays clean.
W=/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-qUpuCy
T=$(mktemp -d /tmp/s61-3.XXXXXX)
git clone -q "$W" "$T/werk" && cd "$T/werk" && bun install --frozen-lockfile >/dev/null 2>&1 && touch node_modules/.installed || { echo "setup failed"; exit 2; }
FAIL=0
BUNDIR=$(dirname "$(command -v bun)")
CLEANPATH="$BUNDIR:/usr/bin:/bin:/usr/sbin:/sbin"
if PATH="$CLEANPATH" command -v claude >/dev/null; then echo "FAIL(setup): claude reachable"; exit 2; fi
echo "claude on clean PATH: none"
TESTTMP="$T/tmp"; mkdir "$TESTTMP"
# watch the temp dir for harness projects during the run
( while [ ! -f "$T/done" ]; do ls "$TESTTMP" 2>/dev/null | grep '^werk-project-' >> "$T/seen"; sleep 0.2; done ) &
BEFORE=$(git status --porcelain --untracked-files=all --ignored | grep -v '^!! node_modules/')
PATH="$CLEANPATH" TMPDIR="$TESTTMP" make test > "$T/test.log" 2>&1; rc=$?
touch "$T/done"; wait
AFTER=$(git status --porcelain --untracked-files=all --ignored | grep -v '^!! node_modules/')
echo "make test -> $rc"; tail -6 "$T/test.log"
[ $rc = 0 ] || FAIL=1
echo "distinct werk-project dirs seen in TMPDIR: $(sort -u "$T/seen" 2>/dev/null | wc -l | tr -d ' ')"
[ -s "$T/seen" ] || { echo "FAIL: no harness temp projects seen"; FAIL=1; }
echo "status before: [$BEFORE]"; echo "status after: [$AFTER]"
[ "$BEFORE" = "$AFTER" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || { echo "FAIL: tree changed"; FAIL=1; }
echo "TMP=$T"
echo "RESULT=$FAIL"
