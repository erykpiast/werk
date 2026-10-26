import { describe, expect, test } from 'bun:test'
import type { Failure } from './build-prompt.ts'
import { decisionFollowUpText, decisionTrigger, personGaps, proposalsOf, raisedBy } from './decision-pass.ts'
import { fold } from './fold.ts'
import type { Event } from './types.ts'

const review = (...findings: Array<[string, string]>): Failure => ({ kind: 'review', findings: findings.map(([area, severity]) => ({ area, severity, impact: 'x' })) })
const grade = (...cards: string[]): Failure => ({ kind: 'grade', lines: cards.map((card) => ({ card, score: 2, gap: 'x' })) })
const check: Failure = { kind: 'check', cmd: 'make test', code: 2, tail: 'red' }

describe('raisedBy (#st-build-missing-decision)', () => {
  test('a review raises the areas of its severe findings, or of every finding when none is severe', () => {
    expect(raisedBy(review(['security', 'HIGH'], ['design', 'MEDIUM'], ['security', 'critical']))).toEqual(['security findings'])
    expect(raisedBy(review(['design', 'MEDIUM'], ['tests', 'LOW']))).toEqual(['design findings', 'tests findings'])
  })

  test('a grade raises the cards it scored low; any other failure raises nothing', () => {
    expect(raisedBy(grade('a', 'b', 'a'))).toEqual(['#a', '#b'])
    expect(raisedBy(check)).toEqual([])
    expect(raisedBy(undefined)).toEqual([])
  })
})

describe('decisionTrigger (#st-build-missing-decision)', () => {
  test('a named spec gap makes the next pass a decision pass, whatever failed', () => {
    expect(decisionTrigger({ last: check, named: { cause: 'spec-gap', why: 'no card says who may call it' } })).toBe('a pass named a spec gap as the cause of a failure: no card says who may call it')
    expect(decisionTrigger({ last: check, named: { cause: 'builder-error', why: 'typo' } })).toBeUndefined()
  })

  test('a grader gap that only a person can settle triggers it at once (#st-build-cap-spec-gap)', () => {
    const asked: Failure = { kind: 'grade', lines: [{ card: 'criterion-2', score: 2, gap: 'the step asks for what #kid forbids', person: true }, { card: 'a', score: 2, gap: 'x' }] }
    expect(personGaps(asked)).toEqual(['the step asks for what #kid forbids'])
    expect(personGaps(grade('a'))).toEqual([])
    expect(decisionTrigger({ last: asked })).toBe('the grader said a person must settle: the step asks for what #kid forbids')
  })

  test('the same area raised by the reviewers twice in a row triggers it; a new area does not', () => {
    expect(decisionTrigger({ before: review(['security', 'HIGH']), last: review(['security', 'HIGH'], ['design', 'HIGH']) })).toBe('the reviewers raised security findings in two passes in a row')
    expect(decisionTrigger({ before: review(['design', 'HIGH']), last: review(['security', 'HIGH']) })).toBeUndefined()
  })

  test('the grader scoring the same card low twice in a row triggers it', () => {
    expect(decisionTrigger({ before: grade('a'), last: grade('a', 'b') })).toBe('the grader raised #a in two passes in a row')
  })

  test('two failures at different gates, or with no failure before, do not', () => {
    expect(decisionTrigger({ before: grade('a'), last: review(['a', 'HIGH']) })).toBeUndefined()
    expect(decisionTrigger({ last: review(['security', 'HIGH']) })).toBeUndefined()
    expect(decisionTrigger({ before: check, last: check })).toBeUndefined()
  })
})

describe('proposalsOf (#st-build-missing-decision)', () => {
  const log = (...events: Array<[string, Record<string, unknown>]>): Event[] => events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }) as Event)

  test("the cards every build of the ticket proposed, ghost or accepted, and no other ticket's", () => {
    const g = fold(
      log(
        ['obligation.created', { id: 'build-a1', ticket: 'r/01', cites: [] }],
        ['obligation.created', { id: 'build-a2', ticket: 'r/01', cites: [] }],
        ['obligation.created', { id: 'build-b1', ticket: 'r/02', cites: [] }],
        ['node.proposed', { id: 'p1', kind: 'card', title: 'P1', obligation: 'build-a1' }],
        ['node.proposed', { id: 'p2', kind: 'card', title: 'P2', obligation: 'build-a2' }],
        ['node.proposed', { id: 'p2:opt0', kind: 'option', title: 'no', obligation: 'build-a2' }],
        ['node.proposed', { id: 'q1', kind: 'card', title: 'Q1', obligation: 'build-b1' }],
      ),
    )
    expect(proposalsOf(g, 'r/01').map((n) => n.id)).toEqual(['p1', 'p2'])
    expect(proposalsOf(g, 'r/03')).toEqual([])
  })
})

describe('decisionFollowUpText', () => {
  test('a ticket file that names each change, and carries the cites, the checks and the touches', () => {
    const text = decisionFollowUpText({ of: 'r/01', changes: ['#p1 removed'], cites: ['kid'], checks: ['make test'], touches: ['server'] })
    expect(text).toStartWith('title: Rework r/01 for a decision that changed after it merged\ncites: kid\nblocked_by:\nstories:\ntouches: server\n')
    expect(text).toContain('- #p1 removed')
    expect(text).toContain('- [ ] The code follows the map after: #p1 removed')
    expect(text).toContain('- `make test`')
  })
})
