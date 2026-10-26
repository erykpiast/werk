#!/bin/bash
# 61.3 The tests pass on a machine with no real agent installed.
source "$(dirname "$0")/common.sh"
W="$(clone)"; cd "$W"
# A PATH with no claude: a bin dir with links to only the tools make test needs.
NB="$(mktemp -d)"; for t in bun bunx git make; do ln -s "$(command -v $t)" "$NB/$t"; done
SAFE="$NB:/usr/bin:/bin:/usr/sbin:/sbin"
check "no claude on the PATH" '! PATH="$SAFE" command -v claude >/dev/null'
make node_modules/.installed >/dev/null 2>&1   # dependencies installed (Given)
BEFORE="$(git status --porcelain --untracked-files=all)"
env -i HOME="$HOME" PATH="$SAFE" TMPDIR="${TMPDIR:-/tmp}" make test > /tmp/heldout-61.3.log 2>&1; rc=$?
tail -6 /tmp/heldout-61.3.log
check "make test exits 0" '[ $rc = 0 ]'
check "harness test of fake agent events + file edit ran and passed" 'grep -q "fake agent replays its scripted events and edits a file in the project" /tmp/heldout-61.3.log || grep -qE "^ *[0-9]+ pass" /tmp/heldout-61.3.log'
check "harness makes projects in a temporary directory" 'grep -q "mkdtempSync(join(tmpdir()" src/test/harness.ts'
AFTER="$(git status --porcelain --untracked-files=all)"; echo "status after: $AFTER"
check "working tree has no new or changed files" '[ "$BEFORE" = "$AFTER" ]'
exit $FAILED
