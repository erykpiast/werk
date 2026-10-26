// kill.ts — the shape of one kill criterion (#kill-shape) and the decide-time question
// (#kill-ask). Pure, so each case is one call and one expected value.
import { describe, expect, test } from 'bun:test'
import { buildCriterion, describe as describeKill, killPrompt } from './kill.ts'
import type { KillCriterion } from './types.ts'

describe('buildCriterion', () => {
  test('an unknown or missing form is refused, naming the forms', () => {
    expect(buildCriterion({})).toEqual({ error: '--form must be one of metric, manual, no-metric, revisit' })
    expect(buildCriterion({ form: 'vibes' })).toHaveProperty('error')
  })

  test('a metric needs a source, a metric, a threshold and a window, and names each missing flag', () => {
    expect(buildCriterion({ form: 'metric', source: 'posthog' })).toEqual({
      error: '--form metric also needs --metric --threshold --window',
    })
    expect(
      buildCriterion({ form: 'metric', source: 'posthog', metric: 'opens', threshold: '< 10', window: '7d', 'min-sample': '100', fallback: 'c:opt0' }),
    ).toEqual({
      form: 'metric',
      trigger: 'metric',
      state: 'monitored',
      source: 'posthog',
      metric: 'opens',
      threshold: '< 10',
      window: '7d',
      minSample: 100,
      fallback: 'c:opt0',
    })
  })

  test('a min sample is a whole number, 1 or more', () => {
    for (const bad of ['0', '-3', '1.5', 'many']) {
      expect(buildCriterion({ form: 'revisit', 'min-sample': bad })).toEqual({ error: '--min-sample must be a whole number, 1 or more' })
    }
  })

  test('a manual test needs its words; a review date makes the trigger a date', () => {
    expect(buildCriterion({ form: 'manual' })).toEqual({ error: '--form manual also needs --text' })
    expect(buildCriterion({ form: 'manual', text: 'I try it' })).toMatchObject({ trigger: 'event', text: 'I try it' })
    expect(buildCriterion({ form: 'manual', text: 'I try it', 'review-date': '2026-11-01' })).toMatchObject({
      trigger: 'date',
      reviewDate: '2026-11-01',
    })
  })

  test('a review date must be YYYY-MM-DD', () => {
    expect(buildCriterion({ form: 'revisit', 'review-date': '1 Nov' })).toEqual({ error: '--review-date must be YYYY-MM-DD' })
  })

  test('no metric: the reason picks the trigger, and a date reason needs a review date', () => {
    expect(buildCriterion({ form: 'no-metric', text: 'x' })).toEqual({ error: '--form no-metric also needs --reason' })
    expect(buildCriterion({ form: 'no-metric', text: 'x', reason: 'mood' })).toHaveProperty('error')
    expect(buildCriterion({ form: 'no-metric', text: 'x', reason: 'cheap' })).toMatchObject({ reason: 'cheap', trigger: 'none' })
    expect(buildCriterion({ form: 'no-metric', text: 'x', reason: 'values' })).toMatchObject({ trigger: 'event' })
    expect(buildCriterion({ form: 'no-metric', text: 'x', reason: 'slow' })).toEqual({
      error: '--reason slow is revisited by a review date. Add --review-date YYYY-MM-DD',
    })
    expect(buildCriterion({ form: 'no-metric', text: 'x', reason: 'unclear', 'review-date': '2026-12-01' })).toMatchObject({ trigger: 'date' })
  })

  test('revisit keeps no trigger, even with a review date on record', () => {
    expect(buildCriterion({ form: 'revisit', 'review-date': '2026-12-01' })).toEqual({
      form: 'revisit',
      trigger: 'none',
      state: 'monitored',
      reviewDate: '2026-12-01',
    })
  })
})

describe('describe', () => {
  const c = (o: Partial<KillCriterion>) => ({ trigger: 'none', state: 'monitored', ...o }) as KillCriterion
  test('one line per form', () => {
    expect(describeKill(c({ form: 'metric', source: 's', metric: 'm', threshold: '> 1', window: '7d' }))).toBe('s: m > 1 over 7d')
    expect(describeKill(c({ form: 'metric', source: 's', metric: 'm', threshold: '> 1', window: '7d', minSample: 5 }))).toBe(
      's: m > 1 over 7d, min sample 5',
    )
    expect(describeKill(c({ form: 'manual', text: 'try' }))).toBe('manual test: try')
    expect(describeKill(c({ form: 'no-metric', reason: 'cheap', text: 'why' }))).toBe('no metric (cheap): why')
    expect(describeKill(c({ form: 'revisit' }))).toBe('revisit at any time')
  })
})

describe('killPrompt', () => {
  test('asks the question and drafts one command per form for the card', () => {
    const p = killPrompt('c', [])
    expect(p).toContain('what must become true to change this decision?')
    for (const form of ['metric', 'manual', 'no-metric', 'revisit']) expect(p).toContain(`kill c --form ${form}`)
    expect(p).not.toContain('--fallback')
    expect(p).not.toContain('Rejected options')
  })

  test('the first rejected option becomes the fallback, and every option is listed', () => {
    const p = killPrompt('c', [
      { id: 'c:opt0', title: 'Keep it' },
      { id: 'c:opt1', title: 'Drop it' },
    ])
    expect(p).toContain('kill c --form revisit --fallback c:opt0')
    expect(p).toContain('Rejected options a criterion can fall back to: c:opt0 (Keep it); c:opt1 (Drop it)')
  })
})
