#!/usr/bin/env bash
# Held-out steps 01.1, 19.5, 61.1-61.4. Runs on a fresh clone in a temp dir; never edits the checkout.
set -u
CHECKOUT=$(cd "$(dirname "$0")/../.." && pwd)
SHA=$(git -C "$CHECKOUT" rev-parse HEAD)
ROOT=$(mktemp -d /tmp/werk-heldout-repo-XXXX)
C="$ROOT/werk"
LOG="$ROOT/log"; mkdir -p "$LOG"
pass() { echo "RESULT $1 pass: $2"; }
fail() { echo "RESULT $1 fail: $2"; }
note() { echo "NOTE $*"; }
# A PATH with no claude program on it.
NOCLAUDE=$(echo "$PATH" | tr ':' '\n' | while read -r d; do [ -n "$d" ] && [ ! -e "$d/claude" ] && printf '%s:' "$d"; done)
NOCLAUDE=${NOCLAUDE%:}
want() { [ -z "${STEPS:-}" ] || echo " $STEPS " | grep -q " $1 "; }
mk() { (cd "$C" && PATH="$NOCLAUDE" make "$@"); }

git clone -q "$CHECKOUT" "$C" && git -C "$C" checkout -q "$SHA" || { echo "clone failed"; exit 3; }

(cd "$C" && PATH="$NOCLAUDE" bun install --frozen-lockfile >/dev/null 2>&1)
# ---- 61.1
if want 61.1; then
first=$(git -C "$C" rev-list --max-parents=0 HEAD)
nroots=$(echo "$first" | wc -l | tr -d ' ')
files=$(git -C "$C" ls-tree -r --name-only "$first" | wc -l | tr -d ' ')
mainref=$(git -C "$C" rev-parse --verify -q origin/main || echo "")
bad=0
for c in $(git -C "$C" rev-list "${mainref:-HEAD}"); do git -C "$C" merge-base --is-ancestor "$first" "$c" || bad=$((bad+1)); done
note "61.1 roots=$nroots files_in_first=$files main=$mainref not_descendants=$bad"
(cd "$C" && PATH="$NOCLAUDE" bun install --frozen-lockfile >/dev/null 2>&1)
res611=""
for t in test test-coverage typecheck lint e2e; do
  mk "$t" >"$LOG/611-$t.txt" 2>&1; code=$?
  res611="$res611 $t=$code"
done
note "61.1 exits:$res611"
e2especs=$(cd "$C" && ls e2e/*.e2e.ts 2>/dev/null | wc -l | tr -d ' ')
if [ "$nroots" = 1 ] && [ "$files" = 0 ] && [ "$bad" = 0 ] && ! echo "$res611" | grep -q '=[1-9]'; then
  pass 61.1 "one root commit with $files files; all main commits descend from it; exits:$res611 (repo has $e2especs e2e specs, so the no-spec case is not exercised)"
else
  fail 61.1 "roots=$nroots files_in_first=$files not_descendants=$bad exits:$res611"
fi

fi
# ---- 01.1
if want 01.1; then
mk test >"$LOG/011-test.txt" 2>&1; t1=$?
covword=$(grep -ciE 'coverage|% (lines|funcs)|\| *[0-9.]+ *\|' "$LOG/011-test.txt")
cov1=$(grep -c '' "$LOG/611-test-coverage.txt")
mk test-coverage >"$LOG/011-cov.txt" 2>&1; c1=$?
listed=$(grep -vE '^\s*(#|$)' "$C/pure-files.txt")
missing_lines=""
for f in $listed; do grep -E "[0-9]+(\.[0-9]+)?%  +$f( |$)" "$LOG/011-cov.txt" >/dev/null || missing_lines="$missing_lines $f"; done
VICTIM=src/map/notes.ts; VT=src/map/notes.test.ts
rm "$C/$VT"
mk test-coverage >"$LOG/011-cov2.txt" 2>&1; c2=$?
vline=$(grep -E "$VICTIM" "$LOG/011-cov2.txt" | head -3)
mk test >"$LOG/011-test2.txt" 2>&1; t2=$?
covfail2=$(grep -ciE 'coverage' "$LOG/011-test2.txt")
git -C "$C" checkout -q -- "$VT"
note "01.1 test=$t1 coverage-words-in-test=$covword cov=$c1 lines-missing:[$missing_lines] after-delete cov=$c2 line=[$vline] test=$t2 cov-words=$covfail2"
if [ $t1 = 0 ] && [ "$covword" = 0 ] && [ $c1 = 0 ] && [ -z "$missing_lines" ] && [ $c2 != 0 ] && echo "$vline" | grep -q '0%' && echo "$vline" | grep -q "$VT" && [ $t2 = 0 ] && [ "$covfail2" = 0 ]; then
  pass 01.1 "make test exit 0 with no coverage output; make test-coverage exit 0 with a % line for each of $(echo $listed | wc -w | tr -d ' ') listed files; after deleting $VT: coverage exit $c2 and line '$vline'; make test exit 0"
else
  fail 01.1 "test=$t1 covwords=$covword cov=$c1 missing:[$missing_lines] cov2=$c2 line=[$vline] test2=$t2"
fi

fi
# ---- 61.4
if want 61.4; then
python3 - "$C/web/escape.test.ts" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=s[:s.index('describe("entityCharAtEnd"')]
s=s.replace("import { entityCharAtEnd, escapeHtml }","import { escapeHtml }")
open(p,"w").write(s)
PY
mk test >"$LOG/614-test.txt" 2>&1; t=$?
mk test-coverage >"$LOG/614-cov.txt" 2>&1; c=$?
eline=$(grep -E "web/escape.ts" "$LOG/614-cov.txt" | head -2)
git -C "$C" checkout -q -- web/escape.test.ts
mk test-coverage >"$LOG/614-cov2.txt" 2>&1; c3=$?
note "61.4 test=$t cov=$c line=[$eline] restored cov=$c3"
pct=$(echo "$eline" | grep -oE '[0-9]+(\.[0-9]+)?%' | head -1 | tr -d '%')
if [ -z "$pct" ] || awk "BEGIN{exit !($pct>=90)}"; then
  echo "RESULT 61.4 binder-error: deleting the entityCharAtEnd tests did not drop web/escape.ts below 90% (line=[$eline])"
elif [ $t = 0 ] && [ $c != 0 ] && [ $c3 = 0 ]; then
  pass 61.4 "deleted entityCharAtEnd tests of web/escape.ts: make test exit 0; make test-coverage exit $c with '$eline'; restored: exit 0"
else
  fail 61.4 "test=$t cov=$c line=[$eline] restored=$c3"
fi

fi
# ---- 61.2
if want 61.2; then
(cd "$C" && PATH="$NOCLAUDE" bun src/cli.ts help) >"$LOG/612-help1.txt" 2>&1; h1=$?
before=$(grep -E '^  [a-z][a-z-]*( |$)' "$LOG/612-help1.txt" | awk '{print $1}' | sort)
regs=$(grep -hE '^  name: "[a-z-]+"' $(ls "$C"/src/verbs/*.ts | grep -v '\.test\.ts$') | sed 's/^  name: "//;s/".*//' | sort -u)
cat >"$C/src/verbs/ping.ts" <<'TS'
import { registerVerb } from "../cli/registry.ts";

registerVerb({
  name: "ping",
  help: "Print pong.",
  positionals: [],
  run: (_args, io) => {
    io.out("pong\n");
    return 0;
  },
});
TS
(cd "$C" && PATH="$NOCLAUDE" bun src/cli.ts help) >"$LOG/612-help2.txt" 2>&1; h2=$?
after=$(grep -E '^  [a-z][a-z-]*( |$)' "$LOG/612-help2.txt" | awk '{print $1}' | sort)
status=$(git -C "$C" status --porcelain)
missingreg=$(comm -23 <(echo "$regs") <(echo "$before") | tr '\n' ' ')
lost=$(comm -23 <(echo "$before") <(echo "$after") | tr '\n' ' ')
hasping=$(echo "$after" | grep -cx ping)
hashelp=$(echo "$before" | grep -cx help)
rm "$C/src/verbs/ping.ts"
note "61.2 h1=$h1 h2=$h2 verbs-before=$(echo $before | wc -w) registered-not-listed=[$missingreg] lost=[$lost] ping=$hasping help=$hashelp status=[$status]"
if [ $h1 = 0 ] && [ $h2 = 0 ] && [ -z "$missingreg" ] && [ -z "$lost" ] && [ "$hasping" = 1 ] && [ "$hashelp" = 1 ] && [ "$status" = "?? src/verbs/ping.ts" ]; then
  pass 61.2 "help listed all $(echo $before | wc -w | tr -d ' ') registered verbs incl. help; after adding src/verbs/ping.ts only, help listed ping plus all earlier verbs; git status: '$status'"
else
  fail 61.2 "h1=$h1 h2=$h2 registered-not-listed=[$missingreg] lost=[$lost] ping=$hasping status=[$status]"
fi

fi
# ---- 61.3
if want 61.3; then
(PATH="$NOCLAUDE" command -v claude) && note "claude still found!"
git -C "$C" status --porcelain --ignored >"$LOG/613-before.txt"
mk test >"$LOG/613-test.txt" 2>&1; t=$?
git -C "$C" status --porcelain --ignored >"$LOG/613-after.txt"
d=$(diff "$LOG/613-before.txt" "$LOG/613-after.txt")
fakeuse=$(grep -l "fake-bin\|FAKE_DIR" "$C/src/test/setup.ts" "$C/src/test/project.ts" | wc -l | tr -d ' ')
note "61.3 test=$t tree-diff=[$d] fake-wiring-files=$fakeuse"
if [ $t = 0 ] && [ -z "$d" ]; then
  pass 61.3 "no claude on PATH; make test exit 0; the clone's working tree (incl. ignored files) is unchanged after the run; the test harness puts src/test/fake-bin first and runs each CLI test in a mkdtemp project"
else
  fail 61.3 "test=$t tree-diff=[$d]"
fi

fi
# ---- 19.5
if want 19.5; then
mk test >"$LOG/195-a.txt" 2>&1; a=$?
rm "$C/.claude/agents/test-scope.md"; cp "$C/src/agent/subagents/test-scope.md" "$C/.claude/agents/test-scope.md"
mk test >"$LOG/195-b.txt" 2>&1; b=$?
named=$(grep -c "test-scope" "$LOG/195-b.txt")
git -C "$C" checkout -q -- .claude/agents/test-scope.md
[ -L "$C/.claude/agents/test-scope.md" ] || note "19.5 link not restored"
mk test >"$LOG/195-c.txt" 2>&1; c=$?
note "19.5 before=$a copy=$b named=$named back=$c"
if [ $a = 0 ] && [ $b != 0 ] && [ "$named" -gt 0 ] && [ $c = 0 ]; then
  pass 19.5 "make test exit 0; with test-scope.md as a plain copy: exit $b and the output names test-scope ($(grep -m1 'test-scope.md:' "$LOG/195-b.txt")); link back: exit 0"
else
  fail 19.5 "before=$a copy=$b named=$named back=$c"
fi
fi
echo "LOGS $LOG"
