#!/bin/bash
# 61.4 The coverage gate fails below 90% on a pure file and passes again at 90% or above.
source "$(dirname "$0")/common.sh"
W="$(clone)"; cd "$W"
make test-coverage > /tmp/heldout-61.4-a.log 2>&1; rc=$?
check "Given: make test-coverage passes" '[ $rc = 0 ]'
# Delete the unit tests of a pure file: src/map/stale-text.ts is only tested by stale-text.test.ts
cp src/map/stale-text.test.ts /tmp/heldout-stale-text.test.ts.bak
cat > src/map/stale-text.test.ts <<'TS'
import { expect, test } from 'bun:test'
test('placeholder', () => expect(1).toBe(1))
TS
make test > /tmp/heldout-61.4-b.log 2>&1; rc=$?
check "make test exits 0 with tests deleted" '[ $rc = 0 ]'
make test-coverage > /tmp/heldout-61.4-c.log 2>&1; rc=$?
echo "coverage rc=$rc"; grep -i "stale-text" /tmp/heldout-61.4-c.log | tail -5; tail -8 /tmp/heldout-61.4-c.log
check "make test-coverage exits non-zero" '[ $rc != 0 ]'
check "output names file and a percentage" 'tail -30 /tmp/heldout-61.4-c.log | grep "src/map/stale-text.ts" | grep -qE "[0-9]+(\.[0-9]+)?%"'
cp /tmp/heldout-stale-text.test.ts.bak src/map/stale-text.test.ts
make test-coverage > /tmp/heldout-61.4-d.log 2>&1; rc=$?
check "after restore make test-coverage exits 0" '[ $rc = 0 ]'
exit $FAILED
