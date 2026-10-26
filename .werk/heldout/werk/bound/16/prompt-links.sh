#!/bin/bash
# Held-out step 19.5: the repository check catches a subagent copy that replaces its link.
# Runs on a clone of this checkout, never on the checkout itself.
set -u
SRC=$(cd "$(dirname "$0")/.." && pwd)
COPY=$(mktemp -d)/werk
git clone -q "$SRC" "$COPY"
cp -cR "$SRC/node_modules" "$COPY/node_modules" 2>/dev/null || cp -R "$SRC/node_modules" "$COPY/node_modules"
touch "$COPY/node_modules/.werk-installed"
cd "$COPY"
echo "== links: $(ls -l .claude/agents | tail -n +2 | awk '{print $9,$10,$11}' | tr '\n' ';')"
make test > /tmp/heldout-195-a.txt 2>&1; echo "== first run exit $?"; tail -5 /tmp/heldout-195-a.txt
rm .claude/agents/test-scope.md && cp src/agent/subagents/test-scope.md .claude/agents/test-scope.md
make test > /tmp/heldout-195-b.txt 2>&1; echo "== copy run exit $?"; grep -n "test-scope" /tmp/heldout-195-b.txt | head -5; tail -5 /tmp/heldout-195-b.txt
rm .claude/agents/test-scope.md && ln -s ../../src/agent/subagents/test-scope.md .claude/agents/test-scope.md
make test > /tmp/heldout-195-c.txt 2>&1; echo "== restored run exit $?"; tail -5 /tmp/heldout-195-c.txt
git status --short
rm -rf "$(dirname "$COPY")"
