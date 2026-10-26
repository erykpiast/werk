import { describe, expect, test } from 'bun:test'
import { parseFindings, reviewPrompt } from './review-parse.ts'
import { REVIEW_AREAS } from './rubric.ts'

describe('reviewPrompt', () => {
  test('one area, its question, the severities, the base and the diff', () => {
    const tests = REVIEW_AREAS.find((a) => a.key === 'tests')!
    const p = reviewPrompt(tests, 'abc123', 'diff --git a/x b/x')
    expect(p).toContain('You are a code reviewer for one area: Tests.')
    expect(p).toContain(`Review only this area: ${tests.ask}.`)
    expect(p).toContain('(CRITICAL, HIGH, MEDIUM, LOW)')
    expect(p).toContain('CRITICAL and HIGH fail the build')
    expect(p).toContain('`git diff abc123 HEAD`')
    expect(p).toContain('```diff\ndiff --git a/x b/x\n```')
  })
})

describe('parseFindings', () => {
  test('each finding is tagged with the area; the severity is upper-cased; wrong-typed fields are dropped', () => {
    const text = JSON.stringify([
      { severity: 'high', file: 'a.ts', line: 3, impact: 'breaks', fix: 'fix it' },
      { severity: 'LOW', file: 7, line: '3', impact: 'small', fix: null },
      { severity: 'HIGH', file: 'b.ts' },
    ])
    expect(parseFindings(text, 'tests')).toEqual([
      { area: 'tests', severity: 'HIGH', file: 'a.ts', line: 3, impact: 'breaks', fix: 'fix it' },
      { area: 'tests', severity: 'LOW', file: undefined, line: undefined, impact: 'small', fix: undefined },
    ])
  })

  test('an unknown or missing severity is recorded as MEDIUM, never as blocking', () => {
    const out = parseFindings('[{"severity": "BLOCKER", "impact": "a"}, {"impact": "b"}]', 'design')
    expect(out).toEqual([
      { area: 'design', severity: 'MEDIUM', file: undefined, line: undefined, impact: 'a', fix: undefined },
      { area: 'design', severity: 'MEDIUM', file: undefined, line: undefined, impact: 'b', fix: undefined },
    ])
  })

  test('an empty array is no finding; an answer with no array is unreadable', () => {
    expect(parseFindings('Nothing found.\n```json\n[]\n```', 'design')).toEqual([])
    expect(parseFindings('all good', 'design')).toBe('the reviewer did not answer with a JSON array')
  })
})
