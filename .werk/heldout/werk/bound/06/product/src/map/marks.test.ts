import { describe, expect, test } from 'bun:test'
import type { EventBody, LogEvent, ReopenReason } from './events.ts'
import { fold } from './fold.ts'
import { describeMark, markOf, marksOf, type Mark } from './marks.ts'

const AT = '2026-10-19T00:00:00.000Z'
const log = (...bodies: EventBody[]): LogEvent[] => bodies.map((body, i) => ({ ...body, seq: i + 1, at: AT }))

const card = (id: string): EventBody => ({ type: 'added', id, kind: 'card', title: id })
const dependsOn = (from: string, to: string): EventBody => ({ type: 'linked', from, to, link: 'depends_on' })
const refines = (from: string, to: string): EventBody => ({ type: 'linked', from, to, link: 'refines' })
const decide = (id: string): EventBody => ({ type: 'decided', id })
const reopen = (id: string, reason: ReopenReason, why = `${reason} ${id}`): EventBody => ({ type: 'reopened', id, reason, why })

/**
 * A chain and a child: c depends_on b depends_on a, d depends_on c, and k refines a.
 * Every card is decided, so a reopen of a is the first change.
 */
const chain = [card('a'), card('b'), card('c'), card('d'), card('k'), dependsOn('b', 'a'), dependsOn('c', 'b'), dependsOn('d', 'c'), refines('k', 'a'), ...['a', 'b', 'c', 'd', 'k'].map(decide)]
const marked = (map: ReturnType<typeof fold>) =>
  Object.fromEntries(
    Object.values(map.cards)
      .map((c) => [c.id, markOf(c)] as const)
      .filter(([, mark]) => mark !== undefined),
  )

describe('a rejected reopen marks the next hop only, stale (#vi-prop)', () => {
  const map = fold(log(...chain, reopen('a', 'rejected', 'the content is wrong')))

  test('the direct dependent and the direct child are stale, and a card two hops away has no mark', () => {
    expect(marked(map)).toEqual({ b: 'stale', k: 'stale' })
    expect(map.cards.c!.stale).toEqual([])
    expect(map.cards.c!.paused).toEqual([])
  })

  test('the mark keeps its trace: the change, the reason, the link and the why', () => {
    expect(map.cards.b!.stale).toEqual([{ because: 'a', seq: 15, at: AT, change: 'reopened', reason: 'rejected', via: 'depends_on', path: [], why: 'the content is wrong' }])
    expect(map.cards.k!.stale[0]!.via).toBe('refines')
  })

  test('the reopened card is open and keeps its reopen reason until it is decided again', () => {
    expect(map.cards.a).toMatchObject({ status: 'open', reopen: { reason: 'rejected', why: 'the content is wrong', seq: 15, at: AT } })
    const again = fold(log(...chain, reopen('a', 'rejected'), decide('a')))
    expect(again.cards.a!.reopen).toBeUndefined()
    expect(again.cards.a!.status).toBe('decided')
  })

  test('a review that confirms one stale card clears its mark and leaves the other marks in place', () => {
    const after = fold(log(...chain, reopen('a', 'rejected'), decide('b')))
    expect(marked(after)).toEqual({ k: 'stale' })
  })

  test('a review that amends the card lets the next hop be marked in turn', () => {
    const after = fold(log(...chain, reopen('a', 'rejected'), { type: 'edited', id: 'b', field: 'body', text: 'amended' }, decide('b')))
    expect(marked(after)).toEqual({ c: 'stale', k: 'stale' })
    expect(after.cards.c!.stale[0]).toMatchObject({ because: 'b', change: 'edited', via: 'depends_on' })
  })
})

describe('a postponed reopen marks every card downstream, paused (#pr-wf-paused)', () => {
  const map = fold(log(...chain, reopen('a', 'postponed', 'not now')))

  test('every card downstream is paused, at any distance, and keeps its status', () => {
    expect(marked(map)).toEqual({ b: 'paused', c: 'paused', d: 'paused', k: 'paused' })
    for (const id of ['b', 'c', 'd', 'k']) expect(map.cards[id]!.status).toBe('decided')
    expect(map.cards.a).toMatchObject({ status: 'open', paused: [], stale: [] })
  })

  test('each paused mark names the cards it passed through, nearest the change first', () => {
    expect(map.cards.b!.paused[0]!.path).toEqual([])
    expect(map.cards.d!.paused).toEqual([{ because: 'a', seq: 15, at: AT, change: 'reopened', reason: 'postponed', via: 'depends_on', path: ['b', 'c'], why: 'not now' }])
  })

  test('a review of a paused card does not clear the mark: the work it waits for has not resumed', () => {
    expect(markOf(fold(log(...chain, reopen('a', 'postponed'), decide('b'))).cards.b!)).toBe('paused')
  })

  test('deciding the postponed card again resumes the work and clears every paused mark it caused', () => {
    const after = fold(log(...chain, reopen('a', 'postponed'), decide('a')))
    expect(marked(after)).toEqual({})
  })

  test('resuming one postponed card leaves the paused marks of another', () => {
    const after = fold(log(...chain, reopen('b', 'postponed'), reopen('a', 'postponed'), decide('a')))
    expect(marked(after)).toEqual({ c: 'paused', d: 'paused' })
    expect(after.cards.c!.paused.map((m) => m.because)).toEqual(['b'])
  })

  test('a link made after the postponement carries no paused mark from it', () => {
    const after = fold(log(...chain, card('late'), reopen('a', 'postponed'), dependsOn('late', 'd')))
    expect(markOf(after.cards.late!)).toBeUndefined()
  })

  test('a cycle of depends_on links ends at the changed card', () => {
    const after = fold(log(card('x'), card('y'), dependsOn('y', 'x'), dependsOn('x', 'y'), decide('x'), decide('y'), reopen('x', 'postponed')))
    expect(marked(after)).toEqual({ y: 'paused' })
  })

  test('an option or a source is never marked', () => {
    const after = fold(
      log(
        card('x'),
        { type: 'added', id: 'x:opt0', kind: 'option', title: 'o', whyNot: 'n' },
        { type: 'linked', from: 'x:opt0', to: 'x', link: 'alternative_to' },
        { type: 'added', id: 's', kind: 'source', title: 's', parent: 'x' },
        decide('x'),
        reopen('x', 'postponed'),
        { type: 'retitled', id: 'x', title: 'X' },
      ),
    )
    expect(marked(after)).toEqual({})
  })
})

describe('stale wins over paused (#pr-wf-paused)', () => {
  const both = fold(log(...chain, reopen('b', 'rejected'), reopen('a', 'postponed')))

  test('a card reached by a postponement and an invalidation shows stale', () => {
    expect(both.cards.c!.stale).toHaveLength(1)
    expect(both.cards.c!.paused).toHaveLength(1)
    expect(markOf(both.cards.c!)).toBe('stale')
    expect(marksOf(both.cards.c!, 'paused')).toEqual([])
    expect(marksOf(both.cards.c!, 'stale')[0]!.reason).toBe('rejected')
  })

  test('a card with only a paused mark lists it, and a card with no mark has none', () => {
    expect(marksOf(both.cards.d!, 'paused')[0]!.reason).toBe('postponed')
    expect(markOf(fold(log(card('z'))).cards.z!)).toBeUndefined()
  })

  test('after the review of the stale card, the paused mark shows', () => {
    expect(markOf(fold(log(...chain, reopen('b', 'rejected'), reopen('a', 'postponed'), decide('c'))).cards.c!)).toBe('paused')
  })
})

describe('the trace of a mark, as one line', () => {
  const mark: Mark = { because: 'a', seq: 7, at: AT, change: 'reopened', reason: 'rejected', via: 'depends_on', path: [], why: 'wrong' }

  test('names the card, the change, the reason, the date, the link and the why', () => {
    expect(describeMark(mark)).toBe('#a reopened, rejected, on 2026-10-19 (event 7), over depends_on: wrong')
  })

  test('names the path of a far paused mark', () => {
    expect(describeMark({ ...mark, reason: 'postponed', path: ['b', 'c'] })).toBe('#a reopened, postponed, on 2026-10-19 (event 7), over depends_on through #b, #c: wrong')
  })

  test('an amend has no reason and no why; an event with no time names the event only', () => {
    const { reason: _, why: __, ...amend } = mark
    expect(describeMark({ ...amend, change: 'edited', at: '' })).toBe('#a edited at event 7, over depends_on')
  })
})
