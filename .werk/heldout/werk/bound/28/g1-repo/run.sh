#!/bin/bash
# Held-out checks of group g1-repo. Each step runs in its own throwaway clone of the checkout.
# Usage: run.sh <step id>   (01.1 61.1 61.2 61.3 61.4 19.5 69.5)
# Evidence goes to evidence/<step>.log beside this script; the last line of each log is PASS or FAIL.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="$(cd "$HERE/../.." && pwd)"
STEP="$1"
LOG="$HERE/evidence/$STEP.log"
mkdir -p "$HERE/evidence"
: >"$LOG"
FAILS=()

say() { echo "$*" | tee -a "$LOG"; }
check() { # check <description> <command...>: records ok/FAIL for one line of the step
  local what="$1"; shift
  if "$@" >>"$LOG" 2>&1; then say "ok   $what"; else say "FAIL $what"; FAILS+=("$what"); fi
}
clone() {
  local dir; dir="$(mktemp -d "/tmp/g1-$STEP.XXXX")"
  git clone -q "$CHECKOUT" "$dir/werk" && (cd "$dir/werk" && bun install --frozen-lockfile >/dev/null 2>&1)
  echo "$dir/werk"
}
mk() { # mk <target> <outfile>: runs make in the clone, keeps output, returns make's exit code
  (cd "$W" && make "$1") >"$2" 2>&1; local code=$?
  { echo "--- make $1 exit=$code (tail):"; tail -25 "$2"; } >>"$LOG"; return $code
}
export LOG
export -f mk
finish() {
  if [ ${#FAILS[@]} -eq 0 ]; then say "PASS"; else say "FAIL: ${FAILS[*]}"; fi
}

case "$STEP" in
01.1)
  W="$(clone)"; export W; say "clone $W"
  T="$W/../out"; mkdir -p "$T"
  check "Given: pure list has a first helper with its own test file" \
    bash -c "f=\$(grep -v '^#' '$W/pure-files.txt' | grep . | head -1); echo \$f; test -f '$W/'\$f && test -f '$W/'\${f%.ts}.test.ts"
  check "make test: unit tests pass" mk test "$T/test1.txt"
  check "make test: no coverage check in the report" \
    bash -c "! grep -Eiq 'coverage|pure files|% *(Lines|Funcs)' '$T/test1.txt'"
  check "make test-coverage: passes" mk test-coverage "$T/cov1.txt"
  check "make test-coverage: one line per pure-list file with its line %" bash -c "
    n=0; for f in \$(grep -v '^#' '$W/pure-files.txt' | grep .); do
      c=\$(grep -Ec \"^(ok|FAIL) +[0-9.]+%  \$f( |\$)\" '$T/cov1.txt'); [ \"\$c\" = 1 ] || { echo \"no single line for \$f (\$c)\"; exit 1; }; n=\$((n+1)); done; echo \"\$n files each on one line\""
  rm "$W/src/cli/card-id.test.ts"; say "deleted src/cli/card-id.test.ts"
  check "make test-coverage again: fails" bash -c "! mk test-coverage '$T/cov2.txt'"
  check "output shows 0% for src/cli/card-id.ts and names the missing test file" bash -c "
    grep -E 'src/cli/card-id.ts' '$T/cov2.txt'; grep -Eq '^FAIL +0(\.00)?%  src/cli/card-id.ts.*card-id\.test\.ts' '$T/cov2.txt'"
  check "make test still passes" mk test "$T/test2.txt"
  check "make test has no coverage failure" bash -c "! grep -Eiq 'coverage|pure files' '$T/test2.txt'"
  finish ;;
61.1)
  W="$(clone)"; export W; say "clone $W"
  T="$W/../out"; mkdir -p "$T"
  cd "$W" || exit 1
  check "clone is on the main branch" bash -c "git rev-parse --abbrev-ref HEAD | tee /dev/stderr | grep -qx main"
  ROOTS="$(git rev-list --max-parents=0 main)"; say "roots of main: $ROOTS"
  check "main has one first commit" test "$(echo "$ROOTS" | wc -l | tr -d ' ')" = 1
  check "the first commit holds no files" bash -c "test -z \"\$(git ls-tree -r --name-only $ROOTS)\""
  check "every later commit on main has the first commit as an ancestor" bash -c "
    n=0; for c in \$(git rev-list main); do git merge-base --is-ancestor $ROOTS \$c || { echo bad \$c; exit 1; }; n=\$((n+1)); done; echo \$n commits ok"
  for t in test test-coverage typecheck lint e2e; do check "make $t exits with success" mk $t "$T/$t.txt"; done
  rm -f "$W"/e2e/*.e2e.ts; say "removed every e2e/*.e2e.ts (a project with no browser spec)"
  check "make e2e passes with no browser spec" mk e2e "$T/e2e-empty.txt"
  finish ;;
61.2)
  W="$(clone)"; export W; say "clone $W"
  cd "$W" || exit 1
  bun src/cli.ts help >"$W/../help1.txt" 2>&1; say "help exit=$?"
  bun "$HERE/list-verbs.ts" "$W" >"$W/../verbs1.txt" 2>>"$LOG"; say "registered: $(tr '\n' ' ' <"$W/../verbs1.txt")"
  names() { grep -E '^  [a-z][a-z-]*( |$)' "$1" | awk '{print $1}' | sort -u; }
  check "registry is not empty and holds help" grep -qx help "$W/../verbs1.txt"
  check "help names every registered verb" bash -c "diff <(sort -u '$W/../verbs1.txt') <($(declare -f names); names '$W/../help1.txt')"
  cat >"$W/src/verbs/ping.ts" <<'EOF'
// A verb added by the held-out check: it prints pong.
import { registerVerb } from "../cli/registry.ts";

registerVerb({
  name: "ping",
  help: "Print pong.",
  run: (_args, io) => {
    io.out("pong\n");
    return 0;
  },
});
EOF
  say "added src/verbs/ping.ts"
  bun src/cli.ts help >"$W/../help2.txt" 2>&1; say "help exit=$?"
  check "help names ping" bash -c "$(declare -f names); names '$W/../help2.txt' | grep -qx ping"
  check "help names every verb it named before" bash -c "$(declare -f names); comm -23 <(names '$W/../help1.txt') <(names '$W/../help2.txt') | (! grep .)"
  check "git status shows only the new module" bash -c "git status --porcelain | tee /dev/stderr; test \"\$(git status --porcelain)\" = '?? src/verbs/ping.ts'"
  finish ;;
61.3)
  W="$(clone)"; export W; say "clone $W"
  T="$W/../out"; mkdir -p "$T"
  NOPATH=""; IFS=: read -ra parts <<<"$PATH"
  for p in "${parts[@]}"; do [ -n "$p" ] && [ ! -e "$p/claude" ] && NOPATH="${NOPATH:+$NOPATH:}$p"; done
  say "PATH without claude: $NOPATH"
  check "no claude reachable on PATH" env PATH="$NOPATH" bash -c '! command -v claude'
  git -C "$W" status --porcelain >"$T/before.txt"
  (cd "$W" && env PATH="$NOPATH" make test) >"$T/test.txt" 2>&1; code=$?
  { echo "--- make test exit=$code"; tail -8 "$T/test.txt"; } >>"$LOG"
  check "make test exits with success" test $code = 0
  check "the fake-agent tests (scripted events, file edit, temp project) pass with no claude on PATH" bash -c "
    cd '$W' && env PATH='$NOPATH' bun test ./src/test/fake-agent.test.ts ./src/test/project.test.ts 2>&1 | tail -5 | tee /dev/stderr | grep -Eq '^ *0 fail'"
  check "working tree has no new or changed files" bash -c "git -C '$W' status --porcelain --ignored=no | tee /dev/stderr | diff - '$T/before.txt'"
  finish ;;
61.4)
  W="$(clone)"; export W; say "clone $W"
  T="$W/../out"; mkdir -p "$T"
  check "Given: make test-coverage passes" mk test-coverage "$T/cov0.txt"
  F=src/board/rules.ts
  head -48 "$W/src/board/rules.test.ts" >"$T/cut.ts" && cp "$T/cut.ts" "$W/src/board/rules.test.ts"
  say "kept only the first two tests of src/board/rules.test.ts"
  check "make test exits with success" mk test "$T/test.txt"
  check "make test-coverage exits with an error" bash -c "! mk test-coverage '$T/cov1.txt'"
  check "output names $F with a percentage below 90" bash -c "
    line=\$(grep -E ' $F( |\$)' '$T/cov1.txt'); echo \"\$line\"; p=\$(echo \"\$line\" | grep -Eo '[0-9.]+%' | head -1 | tr -d %); awk -v p=\"\$p\" 'BEGIN{exit !(p<90)}'"
  git -C "$W" checkout -q -- src/board/rules.test.ts; say "restored src/board/rules.test.ts"
  check "make test-coverage exits with success again" mk test-coverage "$T/cov2.txt"
  finish ;;
19.5)
  W="$(clone)"; export W; say "clone $W"
  T="$W/../out"; mkdir -p "$T"
  check "Given: every shipped subagent is linked" bash -c "cd '$W'; for f in src/agent/subagents/*.md; do test -L .claude/agents/\$(basename \$f) || exit 1; done; ls -l .claude/agents"
  check "Given: the repository checks pass (make test)" mk test "$T/test0.txt"
  cp -L "$W/.claude/agents/test-scope.md" "$T/copy.md" && rm "$W/.claude/agents/test-scope.md" && cp "$T/copy.md" "$W/.claude/agents/test-scope.md"
  say "replaced .claude/agents/test-scope.md link with a plain copy"; ls -l "$W/.claude/agents" >>"$LOG"
  check "the checks fail" bash -c "! mk test '$T/test1.txt'"
  check "the failure names the test-scope subagent" bash -c "grep -n 'test-scope' '$T/test1.txt'"
  git -C "$W" checkout -q -- .claude/agents/test-scope.md; say "put the link back"; ls -l "$W/.claude/agents" >>"$LOG"
  check "the checks pass again" mk test "$T/test2.txt"
  finish ;;
69.5)
  W="$(clone)"; export W; say "clone $W"
  T="$W/../out"; mkdir -p "$T"
  check "Given: the checkout has browser specs" bash -c "ls '$W'/e2e/*.e2e.ts"
  git -C "$W" status --porcelain >"$T/before.txt"
  find "$W" -path '*/node_modules' -prune -o -name log.jsonl -print | xargs -I{} sh -c 'echo "{} $(wc -l <"{}")"' | sort >"$T/logs-before.txt"
  check "make e2e passes" mk e2e "$T/e2e.txt"
  check "the run reports a pass/fail result line per test" bash -c "grep -Ec '^ +(✓|✘|-) +[0-9]+ ' '$T/e2e.txt'; grep -E '[0-9]+ (passed|failed)' '$T/e2e.txt'"
  check "one screenshot per test that ran" bash -c "
    ran=\$(grep -Eo '^ +[0-9]+ (passed|failed)' '$T/e2e.txt' | awk '{s+=\$1} END{print s}');
    dirs=\$(ls -d '$W'/test-results/*/ 2>/dev/null | wc -l | tr -d ' ');
    pngs=\$(find '$W/test-results' -name '*.png' | wc -l | tr -d ' ');
    nodir=\$(for d in '$W'/test-results/*/; do ls \"\$d\"*.png >/dev/null 2>&1 || echo \$d; done | wc -l | tr -d ' ');
    echo ran=\$ran dirs=\$dirs pngs=\$pngs dirs_without_png=\$nodir; test \"\$ran\" = \"\$dirs\" && test \"\$nodir\" = 0"
  check "no new events in any project log of the checkout, fixture unchanged" bash -c "
    find '$W' -path '*/node_modules' -prune -o -name log.jsonl -print | xargs -I{} sh -c 'echo \"{} \$(wc -l <\"{}\")\"' | sort | diff '$T/logs-before.txt' -; git -C '$W' status --porcelain | tee /dev/stderr | diff - '$T/before.txt'"
  finish ;;
*) echo "unknown step $STEP"; exit 2 ;;
esac
