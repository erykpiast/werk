// #vi-flow-ms-tests: the record of unit test runs. A junit report folds into one run, and a
// failure that a time limit caused is marked as a timeout.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendRun, parseJunit, readTestRuns } from './test-runs.ts'

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="4" failures="3">
  <testsuite name="a.test.ts" file="a.test.ts" tests="4" failures="3">
    <testcase name="passes" classname="" time="0.000018" file="a.test.ts" line="2" assertions="1" />
    <testcase name="fails on assert" classname="" time="0.000151" file="a.test.ts" line="3" assertions="1">
      <failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 2&#10;Received: 1&#10;">AssertionError</failure>
    </testcase>
    <testcase name="times out" classname="" time="0.051031" file="a.test.ts" line="4" assertions="0">
      <failure type="TimeoutError" message="test timed out" />
    </testcase>
    <testcase name="a classifier &amp; its cap" classname="" time="0.3" file="b.test.ts" line="9" assertions="1">
      <failure type="AssertionError" message="Expected: &quot;killed after 300ms wall-clock cap&quot;">x</failure>
    </testcase>
  </testsuite>
</testsuites>`

describe('parseJunit', () => {
  test('counts every test and keeps the failed ones, with the name, file and first message line', () => {
    const run = parseJunit(XML, '2026-10-24T10:00:00.000Z')
    expect(run.tests).toBe(4)
    expect(run.failed.map((f) => f.name)).toEqual(['fails on assert', 'times out', 'a classifier & its cap'])
    expect(run.failed[0]).toMatchObject({ file: 'a.test.ts', message: 'expect(received).toBe(expected)', ms: 0 })
    expect(run.failed[2].file).toBe('b.test.ts')
  })

  test('a failure is a timeout when the runner ended the test on its time limit, or the message says a limit was reached', () => {
    const run = parseJunit(XML, 'x')
    expect(run.failed.map((f) => f.timeout)).toEqual([false, true, true])
  })

  test('a run with no failure has an empty list, and a report with no test is an empty run', () => {
    expect(parseJunit('<testsuites><testcase name="a" file="f" time="0.1" /></testsuites>', 'x')).toEqual({ at: 'x', tests: 1, failed: [] })
    expect(parseJunit('', 'x')).toEqual({ at: 'x', tests: 0, failed: [] })
  })
})

describe('the run record', () => {
  test('a run appended is read back, oldest first, and a half-written line is skipped', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'werk-runs-')), 'sub', 'test-runs.jsonl')
    appendRun({ at: '1', tests: 2, failed: [] }, path)
    writeFileSync(path, '{"at":"broken\n', { flag: 'a' })
    appendRun({ at: '2', tests: 3, failed: [{ name: 'n', file: 'f', ms: 5, timeout: true, message: 'm' }] }, path)
    expect(readTestRuns(path).map((r) => r.at)).toEqual(['1', '2'])
    expect(readTestRuns(join(tmpdir(), 'no-such-werk-runs.jsonl'))).toEqual([])
  })
})
