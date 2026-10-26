#!/bin/bash
# Held-out steps 01.1, 19.5, 61.1, 61.3, 61.4: the make targets on a fresh clone of this checkout.
# Every edit runs in the clone, never in the checkout. Prints one "CHECK <step> <ok|FAIL> <what>" line per check.
# Usage: slow.sh <step> [...]   (steps: 61.1 01.1 61.4 19.5 61.3)
set -u
SRC="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
SHA="$(git -C "$SRC" rev-parse HEAD)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/werk-heldout-F-XXXXXX")"
LOGS="$ROOT/logs"; mkdir -p "$LOGS"
echo "ROOT $ROOT"

check() { # step, condition-exit-code, text
  if [ "$2" -eq 0 ]; then echo "CHECK $1 ok $3"; else echo "CHECK $1 FAIL $3"; fi
}

clone() {
  local dir="$ROOT/$1"
  git clone -q "$SRC" "$dir" && git -C "$dir" fetch -q "$SRC" "$SHA" && git -C "$dir" checkout -q "$SHA"
  echo "$dir"
}

mk() { # dir, target, log name -> exit code
  (cd "$1" && make "$2" >"$LOGS/$3.log" 2>&1); local c=$?
  echo "RUN $3 exit=$c"; return $c
}

for step in "$@"; do
case "$step" in
61.1)
  roots=$(git -C "$SRC" rev-list --max-parents=0 main)
  n=$(echo "$roots" | wc -l | tr -d ' ')
  check 61.1 $([ "$n" = 1 ]; echo $?) "main has one first commit ($roots)"
  files=$(git -C "$SRC" ls-tree -r "$roots" | wc -l | tr -d ' ')
  check 61.1 $([ "$files" = 0 ]; echo $?) "first commit holds $files files"
  bad=0
  for c in $(git -C "$SRC" rev-list main); do git -C "$SRC" merge-base --is-ancestor "$roots" "$c" || bad=$((bad+1)); done
  check 61.1 $([ "$bad" = 0 ]; echo $?) "commits on main without the first commit as ancestor: $bad"
  git -C "$SRC" merge-base --is-ancestor "$roots" "$SHA"; check 61.1 $? "the merged HEAD has the first commit as ancestor"
  d=$(clone c611)
  for t in test test-coverage typecheck lint e2e; do mk "$d" "$t" "61.1-$t"; check 61.1 $? "make $t exits 0"; done
  ;;
01.1)
  d=$(clone c011)
  mk "$d" test 01.1-test; check 01.1 $? "make test exits 0"
  ! grep -Eq "pure files,|under 90%|coverage" "$LOGS/01.1-test.log"; check 01.1 $? "make test output has no coverage check"
  mk "$d" test-coverage 01.1-cov; check 01.1 $? "make test-coverage exits 0"
  miss=0
  for f in $(grep -v '^#' "$d/pure-files.txt" | grep -v '^$'); do
    grep -Eq "[0-9.]+%  $f( |$)" "$LOGS/01.1-cov.log" || { miss=$((miss+1)); echo "  no line for $f"; }
  done
  check 01.1 $([ "$miss" = 0 ]; echo $?) "one percentage line per pure-file entry (missing $miss)"
  rm "$d/web/escape.test.ts"
  mk "$d" test-coverage 01.1-cov2; c=$?
  check 01.1 $([ "$c" -ne 0 ]; echo $?) "make test-coverage fails after the own test of web/escape.ts is deleted (exit $c)"
  line=$(grep -E " web/escape.ts( |$)" "$LOGS/01.1-cov2.log"); echo "  line: $line"
  echo "$line" | grep -q " 0.00%"; check 01.1 $? "the line for web/escape.ts shows 0%"
  echo "$line" | grep -q "escape.test.ts"; check 01.1 $? "the failure names the missing test file"
  mk "$d" test 01.1-test2; check 01.1 $? "make test still exits 0"
  ! grep -Eq "pure files,|under 90%" "$LOGS/01.1-test2.log"; check 01.1 $? "make test shows no coverage failure"
  ;;
61.4)
  d=$(clone c614)
  F=src/map/search.ts; T=src/map/search.test.ts
  mk "$d" test-coverage 61.4-cov0; check 61.4 $? "make test-coverage passes at the start"
  # Keep the imports and the first test only: cut the test file at the second top-level test.
  bun -e "const f=process.argv[1];const s=await Bun.file(f).text();const i=s.indexOf('\ntest(');const j=s.indexOf('\ntest(',i+1);await Bun.write(f,j<0?s:s.slice(0,j)+'\n');" "$d/$T"
  mk "$d" test 61.4-test; check 61.4 $? "make test exits 0 with the tests deleted"
  mk "$d" test-coverage 61.4-cov1; c=$?
  check 61.4 $([ "$c" -ne 0 ]; echo $?) "make test-coverage exits with an error (exit $c)"
  line=$(grep -E " $F( |$)" "$LOGS/61.4-cov1.log"); echo "  line: $line"
  echo "$line" | grep -Eq "FAIL +[0-9]+\.[0-9]+%"; check 61.4 $? "the output names $F with its percentage, below 90"
  git -C "$d" checkout -q -- "$T"
  mk "$d" test-coverage 61.4-cov2; check 61.4 $? "make test-coverage passes again after the restore"
  ;;
19.5)
  d=$(clone c195)
  mk "$d" test 19.5-test0; check 19.5 $? "the repository checks pass at the start"
  cp --remove-destination "$d/src/agent/subagents/test-scope.md" "$d/.claude/agents/test-scope.md" 2>/dev/null \
    || { rm "$d/.claude/agents/test-scope.md"; cp "$d/src/agent/subagents/test-scope.md" "$d/.claude/agents/test-scope.md"; }
  [ ! -L "$d/.claude/agents/test-scope.md" ]; check 19.5 $? "the link is now a plain copy"
  mk "$d" test 19.5-test1; c=$?
  check 19.5 $([ "$c" -ne 0 ]; echo $?) "the checks fail with the copy (exit $c)"
  grep -q "test-scope" "$LOGS/19.5-test1.log"; check 19.5 $? "the failure names test-scope"
  grep -n "test-scope" "$LOGS/19.5-test1.log" | head -3
  rm "$d/.claude/agents/test-scope.md"; ln -s ../../src/agent/subagents/test-scope.md "$d/.claude/agents/test-scope.md"
  mk "$d" test 19.5-test2; check 19.5 $? "the checks pass again with the link back"
  ;;
61.3)
  d=$(clone c613)
  (cd "$d" && make node_modules/.werk-installed >/dev/null 2>&1)
  before=$(git -C "$d" status --porcelain)
  NEWPATH=""
  IFS=: read -ra parts <<<"$PATH"
  for p in "${parts[@]}"; do [ -e "$p/claude" ] || NEWPATH="${NEWPATH:+$NEWPATH:}$p"; done
  PATH="$NEWPATH" command -v claude >/dev/null; check 61.3 $([ $? -ne 0 ]; echo $?) "no claude on the shell PATH"
  (cd "$d" && PATH="$NEWPATH" make test >"$LOGS/61.3-test.log" 2>&1); c=$?
  check 61.3 $c "make test exits 0 without claude on PATH"
  after=$(git -C "$d" status --porcelain)
  check 61.3 $([ "$before" = "$after" ] && [ -z "$after" ]; echo $?) "the working tree has no new or changed files (status: '$after')"
  ;;
esac
done
echo "LOGS $LOGS"
