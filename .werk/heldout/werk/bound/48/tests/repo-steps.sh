#!/bin/bash
# Held-out steps 01.1 and 19.5: each runs on its own copy of the checkout, because the step edits files.
# Usage: repo-steps.sh <01.1|19.5>
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../repo"
OUT="$HERE/../results"
mkdir -p "$OUT"
step="$1"
copy="$(mktemp -d)/werk"
cp -Rp "$SRC" "$copy"
cd "$copy"
log="$OUT/$step.log"
: >"$log"
verdict() { echo "VERDICT $*" | tee -a "$log"; }

if [ "$step" = "01.1" ]; then
  # The first pure helper and its own test file: the first entry on the pure-file list.
  first=$(grep -v '^#' pure-files.txt | grep -v '^$' | head -1)
  own="${first%.ts}.test.ts"
  echo "first pure file: $first, own test: $own" >>"$log"
  [ -f "$first" ] && [ -f "$own" ] && verdict "given ok" || verdict "given FAIL"

  make test >test1.out 2>&1; c=$?
  cat test1.out >>"$log"
  [ $c -eq 0 ] && verdict "make test passes" || verdict "make test FAILS code=$c"
  grep -qiE 'coverage|% (Funcs|Lines)|threshold' test1.out && verdict "make test mentions coverage FAIL" || verdict "make test no coverage check ok"

  make test-coverage >cov1.out 2>&1; c=$?
  cat cov1.out >>"$log"
  [ $c -eq 0 ] && verdict "test-coverage passes" || verdict "test-coverage FAILS code=$c"
  missing=0
  for f in $(grep -v '^#' pure-files.txt | grep -v '^$'); do
    n=$(grep -F "$f" cov1.out | grep -cE '[0-9]+(\.[0-9]+)?%')
    [ "$n" -eq 1 ] || { missing=1; echo "line count for $f: $n" >>"$log"; }
  done
  [ $missing -eq 0 ] && verdict "one line per pure file with percent ok" || verdict "one line per pure file FAIL"

  # Delete the own test file of a file on the list (a later entry, so the first helper stays intact).
  victim=$(grep -v '^#' pure-files.txt | grep -v '^$' | grep '^src/cli/card-id.ts$' | head -1)
  vtest="${victim%.ts}.test.ts"
  rm "$vtest"
  echo "deleted $vtest" >>"$log"
  make test-coverage >cov2.out 2>&1; c=$?
  cat cov2.out >>"$log"
  grep -F "$victim" cov2.out | grep -qE '(^|[^0-9.])0(\.0+)?%' && verdict "0% for $victim ok" || verdict "0% for $victim FAIL"
  [ $c -ne 0 ] && verdict "test-coverage fails ok" || verdict "test-coverage passes FAIL"
  grep -qF "$vtest" cov2.out && verdict "names missing test ok" || verdict "names missing test FAIL"

  make test >test2.out 2>&1; c=$?
  tail -20 test2.out >>"$log"
  [ $c -eq 0 ] && verdict "make test passes after delete ok" || verdict "make test after delete FAILS code=$c"
  grep -qiE 'coverage' test2.out && verdict "make test coverage failure FAIL" || verdict "make test no coverage failure ok"
fi

if [ "$step" = "19.5" ]; then
  agents=.claude/agents
  ls -la "$agents" >>"$log"
  all=1
  for f in src/agent/subagents/*.md; do [ -L "$agents/$(basename "$f")" ] || all=0; done
  [ $all -eq 1 ] && verdict "given links ok" || verdict "given links FAIL"
  make test >c1.out 2>&1; c=$?
  tail -15 c1.out >>"$log"
  [ $c -eq 0 ] && verdict "checks pass ok" || verdict "checks FAIL code=$c"

  rm "$agents/test-scope.md"
  cp src/agent/subagents/test-scope.md "$agents/test-scope.md"
  make test >c2.out 2>&1; c=$?
  grep -n -B20 '(fail)' c2.out >>"$log"
  echo "lines naming test-scope:" >>"$log"
  grep -n 'test-scope' c2.out >>"$log"
  tail -8 c2.out >>"$log"
  [ $c -ne 0 ] && verdict "checks fail after copy ok" || verdict "checks pass after copy FAIL"
  grep -F '(fail)' c2.out | grep -q 'subagent' && grep -q 'test-scope' c2.out && verdict "names test-scope ok" || verdict "names test-scope FAIL"

  rm "$agents/test-scope.md"
  ln -s ../../src/agent/subagents/test-scope.md "$agents/test-scope.md"
  make test >c3.out 2>&1; c=$?
  tail -8 c3.out >>"$log"
  [ $c -eq 0 ] && verdict "checks pass after relink ok" || verdict "checks FAIL after relink code=$c"
fi
rm -rf "$(dirname "$copy")"
