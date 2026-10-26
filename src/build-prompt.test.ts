import { describe, expect, test } from 'bun:test'
import { asksCause, buildPrompt, gateOf, parseCause, rejectedOf, renderFailure, storyLines } from './build-prompt.ts'
import type { Failure } from './build-prompt.ts'
import { fold } from './fold.ts'
import type { ParsedTicket } from './ticket.ts'
import type { Event } from './types.ts'
import { SPEC } from './testing/samples.ts'

const log = (...events: Array<[Event['type'], Record<string, unknown>]>): Event[] =>
  events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }))

const TICKET: ParsedTicket = {
  file: '01.md',
  num: 1,
  title: 'List',
  cites: ['kid'],
  blockedBy: [],
  stories: [2],
  touches: ['list'],
  whatToBuild: 'List, end to end.',
  acceptance: ['It works', 'It is fast'],
  checks: ['make test'],
  namesFiles: false,
}

const brief = (o: Partial<Parameters<typeof buildPrompt>[0]> = {}) =>
  buildPrompt({
    ticket: TICKET,
    stories: ['2. As a user, I want to add an item, so that it is kept.'],
    cards: [{ id: 'kid', kind: 'card', title: 'Kid', body: 'Kid body.' }],
    rejected: [],
    checks: ['make test', 'make lint'],
    pass: 1,
    cap: 3,
    base: 'abc123',
    obligation: 'build-B1',
    ...o,
  })

describe('storyLines', () => {
  test('keeps only the numbered stories the ticket delivers, trimmed', () => {
    expect(storyLines(SPEC, [2])).toEqual(['2. As a user, I want to add an item, so that it is kept.'])
    expect(storyLines(SPEC, [1, 2])).toHaveLength(2)
    expect(storyLines(SPEC, [9])).toEqual([])
    expect(storyLines('## Problem Statement\n\nx\n', [1])).toEqual([])
  })
})

describe('rejectedOf', () => {
  test('the options rejected for the cited cards, with their reason; other edges and kinds are left out', () => {
    const g = fold(
      log(
        ['node.added', { id: 'kid', kind: 'card', title: 'Kid', status: 'decided' }],
        ['node.added', { id: 'other', kind: 'card', title: 'Other', status: 'decided' }],
        ['node.added', { id: 'kid:opt0', kind: 'option', title: 'Keep it in memory', why_not: 'it is lost on restart' }],
        ['node.added', { id: 'kid:opt1', kind: 'option', title: 'No reason given' }],
        ['node.added', { id: 'other:opt0', kind: 'option', title: 'Not cited' }],
        ['edge.added', { from: 'kid:opt0', to: 'kid', type: 'alternative_to' }],
        ['edge.added', { from: 'kid:opt1', to: 'kid', type: 'alternative_to' }],
        ['edge.added', { from: 'other:opt0', to: 'other', type: 'alternative_to' }],
        ['edge.added', { from: 'other', to: 'kid', type: 'alternative_to' }],
      ),
    )
    expect(rejectedOf(g, ['kid'])).toEqual([
      { card: 'kid', title: 'Keep it in memory', whyNot: 'it is lost on restart' },
      { card: 'kid', title: 'No reason given', whyNot: undefined },
    ])
    expect(rejectedOf(g, [])).toEqual([])
  })
})

describe('buildPrompt: the map index and the search (#st-build-implement-search)', () => {
  test('lists every decided card, and asks for a search before an own decision', () => {
    const p = brief({ index: [{ id: 'vi-routes', title: 'Each view has its own address' }] })
    expect(p).toContain('- #vi-routes — Each view has its own address')
    expect(p).toContain('search "<term>"')
    expect(p).toContain('binds you the same as a cited card')
    expect(brief()).toContain('by id and title:\n\n(none)')
  })

  test('a decision pass searches the map before it proposes (#st-build-missing-decision)', () => {
    const p = brief({ decision: 'the grader failed the same area twice' })
    expect(p).toContain('## This is a decision pass')
    expect(p).toContain('because the grader failed the same area twice')
    expect(p).toContain('If a decided card answers it, or already states a rule that implies the answer, build to that card and propose nothing.')
    expect(p).toContain('--obligation build-B1')
  })

  test('a proposal is checked against the map for a card that already states the rule', () => {
    const p = brief({})
    expect(p).toContain('Before each `add`, check that the card is new.')
    expect(p).toContain('only adds a detail, a value, an exception, or a narrower case')
    expect(p).toContain('what it leaves open')
  })

  test('the brief offers both ways to close the obligation, and says a record is checked (#st-build-card)', () => {
    const p = brief({})
    expect(p).toContain('A. Each time you make a decision that no card gives')
    expect(p).toContain('B. When every choice in your diff came from a cited card')
    expect(p).toContain('followed build-B1 --cards <card-id>,<card-id>')
    expect(p).toContain('fails the pass as an unrecorded decision')
    expect(p).not.toContain('owes the decision map at least one card')
  })

  test('the unrecorded-decision grade line tells the pass to propose a card', () => {
    const f: Failure = { kind: 'grade', lines: [{ card: 'unrecorded-decision', score: 2, gap: 'a file format no card gives' }] }
    expect(renderFailure(f)).toContain('- an unrecorded decision (propose a card for it), score 2/5: a file format no card gives')
  })

  test('the out-of-scope grade line tells the pass to remove the work', () => {
    const f: Failure = { kind: 'grade', lines: [{ card: 'scope-line', score: 1, gap: 'a card page' }] }
    expect(renderFailure(f)).toContain('- out of scope (remove it), score 1/5: a card page')
  })
})

describe('renderFailure', () => {
  test('nothing failed yet', () => {
    expect(renderFailure(undefined)).toBe('Nothing has failed yet.')
  })

  test('each kind of failure says what the next pass must know', () => {
    const cases: Array<[Failure, string[]]> = [
      [{ kind: 'silence', detail: 'no event for 400ms' }, ['cancelled by the overseer: no event for 400ms', 'not evidence that the ticket cannot be built']],
      [{ kind: 'check', cmd: 'make test', code: 2, tail: 'boom' }, ['Command: `make test` (exit 2)', '```\nboom\n```']],
      [
        { kind: 'grade', lines: [{ card: 'criterion-1', score: 2, gap: 'no test' }, { card: 'kid', score: 2, gap: 'no file' }, { card: 'base', score: 1, gap: 'nothing' }] },
        ['- acceptance criterion-1, score 2/5: no test\n- #kid, score 2/5: no file\n- #base, score 1/5: nothing'],
      ],
      [
        {
          kind: 'review',
          findings: [
            { area: 'tests', severity: 'HIGH', file: 'a.ts', line: 3, impact: 'breaks', fix: 'fix it' },
            { area: 'design', severity: 'CRITICAL', impact: 'no file named' },
          ],
        },
        ['- HIGH (tests) a.ts:3 — breaks Fix: fix it', '- CRITICAL (design)  — no file named'],
      ],
      [{ kind: 'looping', reason: 'It repeats itself.' }, ['it was looping: It repeats itself.', 'try a different approach']],
      [{ kind: 'merge', cmd: 'make merged', code: 1, tail: 'red' }, ["on top of the main line's current tip", 'Command: `make merged` (exit 1)', '```\nred\n```']],
      // #st-build-conflict: a conflict says the pass starts fresh, and carries git's output.
      [{ kind: 'merge', cmd: 'git merge werk-build/a', code: 1, tail: 'CONFLICT (add/add)', conflict: true }, ['git could not merge it', 'starts fresh from that tip', '```\nCONFLICT (add/add)\n```']],
      // #st-build-conflict-resolve: a conflict pass keeps the work and names the files to resolve.
      [
        { kind: 'merge', cmd: 'git merge werk-build/a', code: 1, tail: 'CONFLICT (content)', conflict: true, resolving: ['src/list.ts'] },
        ['the earlier work is still here', '- src/list.ts', 'Do not run `git merge --abort`', '```\nCONFLICT (content)\n```'],
      ],
      [{ kind: 'merge', cmd: 'git merge werk-build/a', code: 1, tail: 'x', conflict: true, resolving: [] }, ['without a conflict this time']],
      [{ kind: 'step', step: 'grader', detail: 'cancelled for silence' }, ['the grader step could not judge the change: cancelled for silence', 'Nothing in the code was found wrong']],
    ]
    for (const [f, parts] of cases) {
      const text = renderFailure(f)
      for (const p of parts) expect(text).toContain(p)
    }
    // A review finding with no fix names none.
    expect(renderFailure(cases[3][0])).not.toContain('no file named Fix:')
  })
})

describe('buildPrompt', () => {
  test('the first pass is told it is first, and gets the ticket, stories, cards, checks and obligation', () => {
    const p = brief()
    expect(p.startsWith('/implement ')).toBe(true)
    expect(p).not.toContain('Do not commit')
    expect(p).toContain('You are pass 1 of at most 3')
    expect(p).toContain('You are the first pass. Nothing has been done yet.')
    expect(p).toContain('## Ticket: List')
    expect(p).toContain('List, end to end.')
    expect(p).toContain('- It works\n- It is fast')
    expect(p).toContain('2. As a user, I want to add an item')
    expect(p).toContain('Kid body.')
    expect(p).toContain('## Options that were weighed and rejected\n\n(none)')
    expect(p).toContain('- `make test`\n- `make lint`')
    expect(p).toContain('--obligation build-B1')
    expect(p).toContain('\n    werk search "<term>"')
    expect(p).not.toContain(process.execPath)
    expect(p).not.toContain('cli.ts')
    expect(p).toContain('Nothing has failed yet.')
    expect(p).toContain('You may not ask a question')
  })

  test('a later pass, or a resumed first pass, reads the history from git', () => {
    for (const p of [brief({ pass: 2 }), brief({ pass: 1, resumed: true })]) {
      expect(p).toContain('The repository is the only memory')
      expect(p).toContain('git log --oneline abc123..HEAD')
      expect(p).not.toContain('You are the first pass')
    }
  })

  test('the stories fall back to the numbers, then to none; rejected options carry their reason', () => {
    expect(brief({ stories: [] })).toContain('### User stories it delivers\n\nStory 2')
    expect(brief({ stories: [], ticket: { ...TICKET, stories: [] } })).toContain('None: this ticket delivers no user story')
    const p = brief({ rejected: [{ card: 'kid', title: 'Keep it in memory', whyNot: 'it is lost' }, { card: 'kid', title: 'Bare' }] })
    expect(p).toContain('- for #kid: Keep it in memory — rejected because it is lost')
    expect(p).toContain('- for #kid: Bare\n')
  })

  test('the last failure goes at the end, then the ask for its cause', () => {
    const p = brief({ lastFailure: { kind: 'check', cmd: 'make test', code: 2, tail: 'boom' } })
    expect(p).toContain('```\nboom\n```\n\n## Cause of the last failure')
    expect(p).toContain('CAUSE OF THE LAST FAILURE: <cause> — <one sentence why>')
    expect(p.trimEnd().endsWith('the code was right, and you fixed the test')).toBe(true)
  })

  test('only a check or a merge failure offers a wrong test as a cause', () => {
    expect(brief({ lastFailure: { kind: 'check', cmd: 'make test', code: 2, tail: 'x' } })).toContain('- test-wrong:')
    expect(brief({ lastFailure: { kind: 'merge', cmd: 'make test', code: 2, tail: 'x' } })).toContain('- test-wrong:')
    expect(brief({ lastFailure: { kind: 'grade', lines: [] } as never })).not.toContain('- test-wrong:')
  })

  test('only a merge failure offers conflict as a cause', () => {
    expect(brief({ lastFailure: { kind: 'merge', cmd: 'make test', code: 2, tail: 'x' } })).toContain('- conflict:')
    expect(brief({ lastFailure: { kind: 'check', cmd: 'make test', code: 2, tail: 'x' } })).not.toContain('- conflict:')
  })

  test('a stall, a loop, or a broken step asks for no cause, and neither does a first pass', () => {
    expect(brief()).not.toContain('Cause of the last failure')
    for (const f of [{ kind: 'silence', detail: 'd' }, { kind: 'looping', reason: 'r' }, { kind: 'step', step: 'grader', detail: 'd' }] as Failure[]) {
      expect(brief({ lastFailure: f })).not.toContain('Cause of the last failure')
    }
  })
})

describe('gateOf (#ms-fail)', () => {
  test('each failure names its gate and what the report groups it by', () => {
    const cases: Array<[Failure, ReturnType<typeof gateOf>]> = [
      [{ kind: 'check', cmd: 'make lint', code: 1, tail: '' }, { gate: 'check', name: 'make lint' }],
      [{ kind: 'merge', cmd: 'make test', code: 1, tail: '' }, { gate: 'merge', name: 'make test' }],
      [{ kind: 'grade', lines: [{ card: 'a', score: 2, gap: 'g' }] }, { gate: 'grader', cards: ['a'] }],
      [{ kind: 'review', findings: [{ area: 'tests', severity: 'HIGH', impact: 'i' }] }, { gate: 'review', findings: [{ area: 'tests', severity: 'HIGH' }] }],
      [{ kind: 'step', step: 'review-tests', detail: 'd' }, { gate: 'step', name: 'review-tests' }],
      [{ kind: 'looping', reason: 'r' }, { gate: 'looping' }],
      [{ kind: 'silence', detail: 'd' }, { gate: 'silence' }],
    ]
    for (const [f, g] of cases) expect(gateOf(f)).toEqual(g)
  })
})

describe('parseCause (#ms-fail-cause)', () => {
  test('reads the cause and its reason from the last cause line, in any case', () => {
    const text = 'Fixed it.\nCAUSE OF THE LAST FAILURE: builder-error — wrong field\nmore\nCause of the last failure: spec-gap: the ticket did not say which order'
    expect(parseCause(text)).toEqual({ cause: 'spec-gap', why: 'the ticket did not say which order' })
  })

  test('a wrong test is a cause the next pass names', () => {
    expect(parseCause('CAUSE OF THE LAST FAILURE: test-wrong — it asserted the old order')).toEqual({ cause: 'test-wrong', why: 'it asserted the old order' })
  })

  test('no line, an unknown cause, or no text gives nothing', () => {
    expect(parseCause('done')).toBeUndefined()
    expect(parseCause('CAUSE OF THE LAST FAILURE: weather — rain')).toBeUndefined()
    expect(parseCause(undefined)).toBeUndefined()
  })

  test('only a gate that judged the code asks for a cause', () => {
    const kinds = ['check', 'grade', 'review', 'merge', 'step', 'looping', 'silence'] as const
    expect(kinds.filter((k) => asksCause({ kind: k } as Failure))).toEqual(['check', 'grade', 'review', 'merge'])
  })
})
