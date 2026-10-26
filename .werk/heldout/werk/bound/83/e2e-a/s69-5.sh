#!/bin/sh
# 69.5: clone the checkout, run make e2e, count screenshots, and check the project log is untouched.
set -u
SRC=$(cd "$(dirname "$0")/../.." && pwd)
D=$(mktemp -d /tmp/werk-695-XXXX)
git clone -q "$SRC" "$D/werk" && cd "$D/werk" || exit 2
before=$(cat .werk/log.jsonl 2>/dev/null | wc -l)
make e2e > "$D/e2e.out" 2>&1; code=$?
after=$(cat .werk/log.jsonl 2>/dev/null | wc -l)
ran=$(grep -cE '^\s+(✓|✘)' "$D/e2e.out")
shots=$(find test-results -name evidence.png | wc -l)
echo "make e2e exit=$code tests=$ran screenshots=$shots log lines before=$before after=$after status=$(git status --porcelain | wc -l)"
[ "$code" = 0 ] && [ "$ran" -gt 0 ] && [ "$ran" -eq "$shots" ] && [ "$before" -eq "$after" ] && [ -z "$(git status --porcelain)" ]
