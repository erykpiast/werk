#!/bin/bash
# 61.2 The help verb lists every registered verb; a new verb module appears with no other edit.
source "$(dirname "$0")/common.sh"
W="$(clone)"; cd "$W"
bun install --frozen-lockfile >/dev/null 2>&1
H1="$(bun src/cli/main.ts help)"; echo "$H1"
REG="$(ls src/cli/verbs | grep -E '\.tsx?$' | grep -vE '\.(test|spec)\.' | xargs -I{} grep -ho "name: '[a-z-]*'" src/cli/verbs/{} | sed "s/name: '//; s/'//" | sort)"
MISS=0; for v in $REG; do echo "$H1" | grep -qE "^  $v( |$)" || { echo "missing $v"; MISS=1; }; done
check "help names every registered verb ($(echo $REG | wc -w))" '[ $MISS = 0 ]'
check "help names help" 'echo "$H1" | grep -qE "^  help "'
cat > src/cli/verbs/ping.ts <<'TS'
import { registry } from '../registry.ts'

registry.register({
  name: 'ping',
  summary: 'answer pong',
  run: (_args, io) => {
    io.out('pong')
    return 0
  },
})
TS
H2="$(bun src/cli/main.ts help)"; echo "$H2"
check "help names ping" 'echo "$H2" | grep -qE "^  ping "'
MISS=0; for v in $REG; do echo "$H2" | grep -qE "^  $v( |$)" || MISS=1; done
check "help still names every earlier verb" '[ $MISS = 0 ]'
ST="$(git status --porcelain)"; echo "git status: $ST"
check "git status shows only the new module" '[ "$ST" = "?? src/cli/verbs/ping.ts" ]'
exit $FAILED
