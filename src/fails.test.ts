import { describe, expect, test } from 'bun:test'
import { failReport, gateKeys, renderFailReport, THRESHOLDS } from './fails.ts'
import type { FailInput } from './fails.ts'

let clock = 0
/** One pass record; `at` grows with each call, so builds sort in the order they are made. */
const rec = (loopRun: string, pass: number, o: Partial<FailInput> = {}): FailInput => ({
  ticket: `t-${loopRun}`,
  loopRun,
  pass,
  at: new Date(Date.UTC(2026, 9, 1) + clock++ * 1000).toISOString(),
  green: false,
  cap: 3,
  ...o,
})
const check = (name = 'make test') => ({ gate: 'check' as const, name })

describe('gateKeys', () => {
  test('one key per thing that failed, without duplicates', () => {
    expect(gateKeys({ gate: 'grader', cards: ['a', 'b', 'a'] })).toEqual(['grader: #a', 'grader: #b'])
    expect(gateKeys({ gate: 'grader', cards: [] })).toEqual(['grader'])
    expect(gateKeys({ gate: 'review', findings: [{ area: 'tests', severity: 'HIGH' }, { area: 'tests', severity: 'HIGH' }] })).toEqual(['review: tests HIGH'])
    expect(gateKeys({ gate: 'review', findings: [] })).toEqual(['review'])
    expect(gateKeys({ gate: 'step', name: 'grader' })).toEqual(['step: grader'])
    expect(gateKeys({ gate: 'merge', name: 'make test' })).toEqual(['merge: make test'])
    expect(gateKeys({ gate: 'silence' })).toEqual(['silence'])
  })
})

describe('failReport', () => {
  test('the next pass names the cause of a fail; a rerun that passes makes it flaky; a fail at the cap stays unknown', () => {
    const r = failReport([
      rec('A', 1, { gate: check() }),
      rec('A', 2, { gate: check('make lint'), flaky: true, causeOfLast: { cause: 'spec-gap', why: 'order unstated' } }),
      rec('A', 3, { gate: { gate: 'review', findings: [{ area: 'tests', severity: 'HIGH' }] } }),
    ])
    expect(r.fails.map((f) => [f.pass, f.keys, f.cause, f.why])).toEqual([
      [1, ['check: make test'], 'spec-gap', 'order unstated'],
      [2, ['check: make lint'], 'flaky-check', undefined],
      [3, ['review: tests HIGH'], 'unknown', undefined],
    ])
    expect(r).toMatchObject({ builds: 1, passes: 3, firstPassGreen: 0, capHit: 1, byCause: { 'spec-gap': 1, 'flaky-check': 1, unknown: 1 } })
  })

  test('a check that could not judge the code is check infra, ahead of the cause the next pass names', () => {
    const r = failReport([
      rec('I', 1, { gate: check(), infra: 'killed after 600000ms' }),
      rec('I', 2, { green: true, causeOfLast: { cause: 'builder-error', why: 'x' } }),
    ])
    expect(r.fails.map((f) => [f.cause, f.why])).toEqual([['check-infra', 'killed after 600000ms']])
    expect(renderFailReport(r)).toContain('1 fails by cause: check-infra 1')
    expect(r.signals).toEqual(['"check: make test": 1 fails were flaky or check infra, not the code: fix the check, not the builder'])
  })

  test('a sent-back build counts the red merge it started from, and is not a first-pass green', () => {
    const r = failReport([rec('B', 1, { green: true, gateOfLast: { gate: 'merge', name: 'make test' }, causeOfLast: { cause: 'conflict', why: 'x' } })])
    expect(r.fails).toEqual([{ ticket: 't-B', loopRun: 'B', pass: 0, at: expect.any(String), keys: ['merge: make test'], cause: 'conflict', why: 'x' }])
    expect(r.firstPassGreen).toBe(0)
    const plain = failReport([rec('C', 1, { green: true }), rec('D', 1, { gateOfLast: { gate: 'merge', name: 'm' } }), rec('D', 2, { green: true })])
    expect(plain.firstPassGreen).toBe(1)
    expect(plain.fails.map((f) => [f.loopRun, f.pass, f.cause])).toEqual([
      ['D', 0, 'unknown'],
      ['D', 1, 'unknown'],
    ])
  })

  test('a record with no gate falls back to its failure kind; one with neither is unknown', () => {
    const r = failReport([rec('E', 1, { failure: 'silence' }), rec('E', 2, {}), rec('E', 3, { green: true })])
    expect(r.fails.map((f) => f.keys)).toEqual([['silence'], ['unknown']])
  })

  test('the gate table counts each key with its causes, most frequent first', () => {
    const r = failReport([
      rec('F', 1, { gate: { gate: 'grader', cards: ['a', 'b'] } }),
      rec('F', 2, { gate: { gate: 'grader', cards: ['a'] }, causeOfLast: { cause: 'builder-error', why: '' } }),
      rec('F', 3, { green: true, causeOfLast: { cause: 'false-finding', why: '' } }),
    ])
    expect(r.byGate).toEqual([
      { key: 'grader: #a', total: 2, causes: { 'builder-error': 1, 'false-finding': 1 } },
      { key: 'grader: #b', total: 1, causes: { 'builder-error': 1 } },
    ])
  })

  test('passes per build: median, 90th percentile, and max', () => {
    const r = failReport([rec('G', 1, { green: true }), rec('H', 1), rec('H', 2, { green: true }), rec('I', 1), rec('I', 2), rec('I', 3)])
    expect(r.passesPerBuild).toEqual({ median: 2, p90: 3, max: 3 })
    expect(failReport([]).passesPerBuild).toEqual({ median: 0, p90: 0, max: 0 })
  })
})

describe('signals (#ms-fail thresholds)', () => {
  test('a cap-hit share above 10% fires only from 10 builds on', () => {
    const capped = (n: number) => rec(`cap${n}`, 3, { pass: 3 })
    const green = (n: number) => rec(`ok${n}`, 1, { green: true })
    const nine = failReport([capped(0), capped(1), ...Array.from({ length: 7 }, (_, i) => green(i))])
    expect(nine.signals.some((s) => s.includes('retry cap'))).toBe(false)
    const ten = failReport([capped(0), capped(1), ...Array.from({ length: 8 }, (_, i) => green(i))])
    expect(ten.signals).toContain('2 of 10 builds (20%) reached the retry cap, above 10%: look at ticket size and spec quality before the builder')
    expect(THRESHOLDS.capHitMinBuilds).toBe(10)
  })

  test('the same key in three builds in a row becomes a check candidate; a gap resets the streak', () => {
    const red = (b: string, name = 'make lint') => [rec(b, 1, { gate: check(name) }), rec(b, 2, { green: true })]
    const r = failReport([...red('a'), ...red('b'), ...red('c', 'other'), ...red('d'), ...red('e')])
    expect(r.signals.filter((s) => s.includes('in a row'))).toEqual([])
    const s = failReport([...red('a'), ...red('b'), ...red('c')])
    expect(s.signals).toContain('"check: make lint" failed 3 builds in a row: make it a check or a rubric line')
  })

  test('a judge with more than 20% false findings over at least 5 fails needs a prompt fix', () => {
    const fail = (b: string, cause: 'false-finding' | 'builder-error', area = 'tests') => [
      rec(b, 1, { gate: { gate: 'review', findings: [{ area, severity: 'HIGH' }] } }),
      rec(b, 2, { green: true, causeOfLast: { cause, why: '' } }),
    ]
    const r = failReport([...fail('a', 'false-finding'), ...fail('b', 'false-finding'), ...fail('c', 'builder-error'), ...fail('d', 'builder-error', 'design'), ...fail('e', 'builder-error')])
    // Four fails for tests: under the minimum sample.
    expect(r.signals.some((s) => s.includes('false findings'))).toBe(false)
    const g = (b: string, cause: 'false-finding' | 'builder-error') => [rec(b, 1, { gate: { gate: 'grader', cards: ['x'] } }), rec(b, 2, { green: true, causeOfLast: { cause, why: '' } })]
    const s = failReport([...g('a', 'false-finding'), ...g('b', 'false-finding'), ...g('c', 'builder-error'), ...g('d', 'builder-error'), ...g('e', 'builder-error')])
    expect(s.signals).toContain('grader: 2 of 5 fails (40%) were false findings, above 20%: its prompt needs a fix')
    const t = failReport([...fail('a', 'false-finding'), ...fail('b', 'false-finding'), ...fail('c', 'builder-error'), ...fail('d', 'builder-error'), ...fail('e', 'builder-error')])
    expect(t.signals).toContain('review: tests: 2 of 5 fails (40%) were false findings, above 20%: its prompt needs a fix')
  })
})

describe('renderFailReport', () => {
  test('no records', () => {
    expect(renderFailReport(failReport([]))).toEqual(['No builder loop records yet.'])
  })

  test('the rates, the causes, the gate table and the signals', () => {
    const red = (b: string) => [rec(b, 1, { gate: check('make lint') }), rec(b, 2, { green: true, causeOfLast: { cause: 'builder-error', why: '' } })]
    const lines = renderFailReport(failReport([...red('a'), ...red('b'), ...red('c'), rec('d', 1, { green: true })]))
    expect(lines).toEqual([
      '7 passes over 4 builds',
      'first pass green: 1 of 4 (25%)',
      'retry cap reached: 0 of 4 (0%)',
      'passes per build: median 2, p90 2, max 2',
      '',
      '3 fails by cause: builder-error 3',
      '',
      'fails by gate:',
      '  check: make lint  3  (builder-error 3)',
      '',
      'signals:',
      '  ! "check: make lint" failed 3 builds in a row: make it a check or a rubric line',
    ])
  })

  test('a report with no fails has no gate table and no signals', () => {
    expect(renderFailReport(failReport([rec('a', 1, { green: true })]))).toEqual([
      '1 passes over 1 builds',
      'first pass green: 1 of 1 (100%)',
      'retry cap reached: 0 of 1 (0%)',
      'passes per build: median 1, p90 1, max 1',
      '',
      '0 fails by cause: none',
    ])
  })
})
