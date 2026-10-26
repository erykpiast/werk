#!/bin/bash
# 61.2: help lists every registered verb; a new verb module appears with no other edit.
W=/private/var/folders/xc/_stjh9891jq3t3gsp9j1vy4h0000gn/T/werk-heldout-wt-qUpuCy
T=$(mktemp -d /tmp/s61-2.XXXXXX)
git clone -q "$W" "$T/werk" && cd "$T/werk" && bun install --frozen-lockfile >/dev/null 2>&1 || { echo "setup failed"; exit 2; }
FAIL=0
verbs_of_help() { bun src/cli/main.ts help | sed -n '/^verbs:/,$p' | tail -n +2 | awk '{print $1}' | sort; }
registered() { bun -e "const {loadVerbs}=await import('$T/werk/src/cli/load-verbs.ts'); const {registry}=await import('$T/werk/src/cli/registry.ts'); await loadVerbs(); console.log(registry.list().map(v=>v.name).join('\n'))" | sort; }
H1=$(verbs_of_help); R1=$(registered)
echo "help verbs: $(echo $H1)"
[ "$H1" = "$R1" ] && echo "help == registry" || { echo "FAIL: help != registry"; diff <(echo "$R1") <(echo "$H1"); FAIL=1; }
echo "$H1" | grep -qx help || { echo "FAIL: help not listed"; FAIL=1; }
cat > src/cli/verbs/ping.ts <<'TS'
import { registry } from '../registry.ts'

registry.register({
  name: 'ping',
  summary: 'answer pong',
  run(_args, io) {
    io.out('pong')
    return 0
  },
})
TS
H2=$(verbs_of_help)
echo "help verbs after: $(echo $H2)"
EXPECTED=$(printf '%s\nping\n' "$H1" | sort)
[ "$H2" = "$EXPECTED" ] && echo "ping added, others kept" || { echo "FAIL: help after != before + ping"; diff <(echo "$EXPECTED") <(echo "$H2"); FAIL=1; }
ST=$(git status --porcelain --untracked-files=all)
echo "git status: $ST"
[ "$ST" = "?? src/cli/verbs/ping.ts" ] || { echo "FAIL: git status not only ping.ts"; FAIL=1; }
rm -rf "$T"
echo "RESULT=$FAIL"
