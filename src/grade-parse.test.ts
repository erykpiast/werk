import { describe, expect, test } from 'bun:test'
import { criterionId, deferrable, extractJson, gradePrompt, isCriterion, parseGrade, SCOPE_LINE, UNRECORDED_LINE, recordedCards } from './grade-parse.ts'
import { GRADE_PASS } from './rubric.ts'

describe('extractJson', () => {
  test('a fenced block wins, with or without the json tag', () => {
    expect(extractJson('Here:\n```json\n[1, 2]\n```\nand [3]')).toEqual([1, 2])
    expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  test('with no fence, or a broken one, the outermost array', () => {
    expect(extractJson('I found [{"x": [1]}] in it')).toEqual([{ x: [1] }])
    expect(extractJson('```json\nnot json\n```\n[4]')).toEqual([4])
  })

  test('nothing readable is undefined', () => {
    expect(extractJson('looks fine to me')).toBeUndefined()
    expect(extractJson('[not json]')).toBeUndefined()
    expect(extractJson('```json\n  \n```')).toBeUndefined()
  })
})

describe('gradePrompt', () => {
  test('every card with its why and body, the pass mark, the base and the diff', () => {
    const p = gradePrompt(
      [
        { id: 'kid', kind: 'card', title: 'Kid', why: 'because', body: 'Kid body.' },
        { id: 'bare', kind: 'card', title: 'Bare' },
      ],
      [],
      'abc123',
      'diff --git a/x b/x',
    )
    expect(p).toContain('You are the grader')
    expect(p).toContain('## Acceptance criteria\n\n(none)')
    expect(p).toContain(`A ${GRADE_PASS} passes`)
    expect(p).toContain('`git diff abc123 HEAD`')
    expect(p).toContain('### #kid — Kid\nwhy: because\nKid body.\n\n### #bare — Bare')
    expect(p).toContain('```diff\ndiff --git a/x b/x\n```')
  })
})

describe('gradePrompt: delivery and contradiction lines (#lp-prod-judge)', () => {
  test('each criterion is a delivery line, each card a contradiction line, and a part not built passes', () => {
    const p = gradePrompt([{ id: 'kid', kind: 'card', title: 'Kid' }], ['the log only grows', 'a ghost refuses an edit'], 'b', 'd')
    expect(p).toContain('- criterion-1: the log only grows\n- criterion-2: a ghost refuses an edit')
    expect(p).toContain('does the diff meet this criterion?')
    expect(p).toContain('does the diff do something this card forbids')
    expect(p).toContain('A part of the card that the diff does not build is never a gap')
    expect(p).toContain('"built": <true or false, card lines only>')
  })

  test('one scope line, with the stories in scope (#lp-prod-judge-scope)', () => {
    const p = gradePrompt([], ['c'], 'b', 'd', ['3. As a reader, I open a card'])
    expect(p).toContain(`The line "${SCOPE_LINE}" is the scope line`)
    expect(p).toContain('no acceptance criterion and no user story of the ticket asks for')
    expect(p).toContain('## User stories the ticket delivers\n\n3. As a reader, I open a card')
    expect(gradePrompt([], ['c'], 'b', 'd')).toContain('## User stories the ticket delivers\n\n(none)')
  })

  test('a criterion id is never a card id', () => {
    expect(criterionId(0)).toBe('criterion-1')
    expect(isCriterion('criterion-12')).toBe(true)
    expect(isCriterion('werk-criterion')).toBe(false)
    expect(isCriterion('criterion-1:opt0')).toBe(false)
  })
})

describe('parseGrade', () => {
  test('one line per cited card, in the cited order; a leading # is dropped and a missing gap is empty', () => {
    const text = '[{"card": "#b", "score": 5}, {"card": "a", "score": 2, "gap": "no file"}, {"card": "x", "score": "high"}, {"score": 3}, {"card": "other", "score": 1}]'
    expect(parseGrade(text, ['a', 'b'])).toEqual([
      { card: 'a', score: 2, gap: 'no file' },
      { card: 'b', score: 5, gap: '' },
    ])
  })

  test('a card line marked not built passes with no gap; a criterion or the scope line does not (#lp-prod-judge)', () => {
    const text = JSON.stringify([
      { card: 'kid', score: 1, built: false, gap: 'Not implemented' },
      { card: 'base', score: 1, built: true, gap: 'contradicts' },
      { card: 'criterion-1', score: 1, built: false, gap: 'unmet' },
      { card: SCOPE_LINE, score: 1, built: false, gap: 'extra page' },
    ])
    expect(parseGrade(text, ['criterion-1', SCOPE_LINE, 'kid', 'base'])).toEqual([
      { card: 'criterion-1', score: 1, gap: 'unmet' },
      { card: SCOPE_LINE, score: 1, gap: 'extra page' },
      { card: 'kid', score: GRADE_PASS, gap: '' },
      { card: 'base', score: 1, gap: 'contradicts' },
    ])
  })

  test('a failing line can say a person must settle its gap; a passing line cannot (#st-build-cap-spec-gap)', () => {
    const text = JSON.stringify([
      { card: 'criterion-1', score: 2, gap: 'the step asks for what #kid forbids', person: true },
      { card: 'kid', score: 4, built: true, gap: '', person: true },
      { card: 'base', score: 2, built: true, gap: 'contradicts', person: 'yes' },
    ])
    expect(parseGrade(text, ['criterion-1', 'kid', 'base'])).toEqual([
      { card: 'criterion-1', score: 2, gap: 'the step asks for what #kid forbids', person: true },
      { card: 'kid', score: 4, gap: '' },
      { card: 'base', score: 2, gap: 'contradicts' },
    ])
    expect(gradePrompt([], ['It works'], 'abc', '')).toContain('Set "person": true on a failing line')
  })

  test('a card left out scores 0; an answer with no array is unreadable', () => {
    expect(parseGrade('[]', ['a'])).toEqual([{ card: 'a', score: 0, gap: 'the grader gave no line for this card', missing: true }])
    expect(parseGrade('{"card": "a"}', ['a'])).toBe('the grader did not answer with a JSON array')
  })
})

describe('the unrecorded-decision line (#st-build-card)', () => {
  const named = [{ id: 'role-env', kind: 'card' as const, title: 'Each agent carries its role', why: 'A test tells agents apart.' }]

  test('a build with a "no new decision" record gets a fourth line and the cards it named', () => {
    const p = gradePrompt([], ['c'], 'b', 'd', [], named)
    expect(p).toContain(`The line "${UNRECORDED_LINE}" checks the builder's record "no new decision"`)
    expect(p).toContain('## Cards the builder named\n\n### #role-env — Each agent carries its role')
    expect(p).toContain('score four kinds of line')
  })

  test('a card this build proposed counts as recorded, and the grader sees it marked proposed (#st-build-card-proposed-recorded)', () => {
    const ghost = { id: 'chat-log', kind: 'card' as const, title: 'Each chat has a file', proposed: true }
    const both = recordedCards(named, [ghost, named[0]!])
    expect(both?.map((n) => n.id)).toEqual(['role-env', 'chat-log'])
    expect(recordedCards(undefined, [ghost])).toBeUndefined()
    const p = gradePrompt([], ['c'], 'b', 'd', [], both)
    expect(p).toContain('### #chat-log — Each chat has a file (proposed)')
    expect(p).not.toContain('#role-env — Each agent carries its role (proposed)')
  })

  test('a build with no record gets neither the line nor the section', () => {
    const p = gradePrompt([], ['c'], 'b', 'd')
    expect(p).not.toContain(UNRECORDED_LINE)
    expect(p).not.toContain('Cards the builder named')
    expect(p).toContain('score three kinds of line')
  })

  test('a record that names no decided card says so, and the line still stands', () => {
    expect(gradePrompt([], ['c'], 'b', 'd', [], [])).toContain('(none: the record names no decided card)')
  })

  test('the line never passes as "not built": a low score on it stays low', () => {
    const text = JSON.stringify([{ card: UNRECORDED_LINE, score: 2, built: false, gap: 'picked a file format no named card gives' }])
    expect(parseGrade(text, [UNRECORDED_LINE])).toEqual([{ card: UNRECORDED_LINE, score: 2, gap: 'picked a file format no named card gives' }])
  })
})

describe('the gaps that may merge on the last pass (#st-grade-defer)', () => {
  const small = { card: 'kid', score: GRADE_PASS - 1, gap: 'an empty list still sends the field' }

  test('card lines one point under a pass may merge', () => {
    expect(deferrable([small, { ...small, card: 'base' }])).toBe(true)
  })

  test('a plain contradiction, a missing line, or a gap only a person can settle may not', () => {
    expect(deferrable([{ ...small, score: GRADE_PASS - 2 }])).toBe(false)
    expect(deferrable([{ ...small, score: 0 }])).toBe(false)
    expect(deferrable([{ ...small, person: true }])).toBe(false)
  })

  test('an unmet criterion, the scope line and the record line may not', () => {
    for (const card of [criterionId(0), SCOPE_LINE, UNRECORDED_LINE]) expect(deferrable([small, { ...small, card }])).toBe(false)
  })

  test('no failed line is nothing to merge with', () => {
    expect(deferrable([])).toBe(false)
  })
})
