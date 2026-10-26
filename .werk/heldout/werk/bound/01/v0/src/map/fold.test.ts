import { describe, expect, test } from 'bun:test'
import type { EventBody, LogEvent } from './events.ts'
import { changesSinceDecided, check, fold } from './fold.ts'

/** Gives each body its place in the log, from 1. */
const log = (...bodies: EventBody[]): LogEvent[] => bodies.map((body, i) => ({ ...body, seq: i + 1, at: '2026-10-19T00:00:00.000Z' }))

const card = (id: string, title = id): EventBody => ({ type: 'added', id, kind: 'card', title })
const option = (id: string): EventBody => ({ type: 'added', id, kind: 'option', title: id, whyNot: `not ${id}` })
const source = (id: string): EventBody => ({ type: 'added', id, kind: 'source', title: id, body: 'the finding: 6% to 11%' })
const link = (from: string, to: string, type: 'refines' | 'depends_on' | 'supported_by' | 'alternative_to'): EventBody => ({
  type: 'linked',
  from,
  to,
  link: type,
})

describe('the log of #pr-log, folded', () => {
  const events = log(
    { type: 'added', id: 'a', kind: 'card', title: 'Use a log' },
    { type: 'added', id: 'b', kind: 'card', title: 'Cards fold from it' },
    link('b', 'a', 'refines'),
    { type: 'retitled', id: 'a', title: 'Use an append-only log' },
    { type: 'decided', id: 'a' },
    { type: 'removed', id: 'b' },
    { type: 'restored', id: 'b' },
  )
  const map = fold(events)

  test('the map shows the latest title only, decided, with #b under #a', () => {
    expect(Object.keys(map.cards)).toEqual(['a', 'b'])
    expect(map.cards.a).toMatchObject({ title: 'Use an append-only log', status: 'decided', decidedAt: 5 })
    expect(map.cards.b).toMatchObject({ title: 'Cards fold from it', status: 'open', removed: false })
    expect(map.links).toEqual([{ from: 'b', to: 'a', type: 'refines', why: '', seq: 3 }])
    expect(map.problems).toEqual([])
    expect(map.seq).toBe(7)
  })

  test('the old title stays in the log', () => {
    expect(events[0]).toMatchObject({ type: 'added', title: 'Use a log' })
  })

  test('a remove alone takes the card out; the restore after it cancels it', () => {
    expect(fold(events.slice(0, 6)).cards.b!.removed).toBe(true)
  })
})

describe('a turn edits a card in place (#vi-overwrite)', () => {
  test('a retitle and an edit leave one card with the new text', () => {
    const map = fold(
      log(card('a', 'old'), { type: 'retitled', id: 'a', title: 'new' }, { type: 'edited', id: 'a', field: 'body', text: 'b2' }, {
        type: 'edited',
        id: 'a',
        field: 'why',
        text: 'w2',
      }),
    )
    expect(Object.values(map.cards)).toHaveLength(1)
    expect(map.cards.a).toMatchObject({ title: 'new', body: 'b2', why: 'w2' })
  })
})

describe('the four link types (#vi-edges)', () => {
  test('refines: a change to the parent marks its children, one level down only', () => {
    const map = fold(log(card('p'), card('c'), card('g'), link('c', 'p', 'refines'), link('g', 'c', 'refines'), { type: 'retitled', id: 'p', title: 'P' }))
    expect(map.cards.c!.stale).toEqual([{ because: 'p', seq: 6, via: 'refines' }])
    expect(map.cards.g!.stale).toEqual([])
    expect(map.cards.p!.stale).toEqual([])
  })

  test('depends_on: a change marks the dependent stale, one hop, and not the one behind it', () => {
    const map = fold(
      log(card('a'), card('b'), card('c'), link('b', 'a', 'depends_on'), link('c', 'b', 'depends_on'), { type: 'decided', id: 'a' }, {
        type: 'reopened',
        id: 'a',
        why: 'postponed',
      }),
    )
    expect(map.cards.b!.stale).toEqual([{ because: 'a', seq: 7, via: 'depends_on', why: 'postponed' }])
    expect(map.cards.c!.stale).toEqual([])
    expect(map.cards.a!.status).toBe('open')
  })

  test('a link made after a change carries no mark from it', () => {
    const map = fold(log(card('a'), card('b'), { type: 'retitled', id: 'a', title: 'A' }, link('b', 'a', 'depends_on')))
    expect(map.cards.b!.stale).toEqual([])
  })

  test('supported_by: a dispute flags the card for review and never marks it stale', () => {
    const map = fold(log(card('a'), source('s'), link('a', 's', 'supported_by'), { type: 'disputed', id: 's', why: 'the numbers are old' }))
    expect(map.cards.a!.review).toEqual([{ because: 's', seq: 4, via: 'supported_by', why: 'the numbers are old' }])
    expect(map.cards.a!.stale).toEqual([])
  })

  test('alternative_to: an option keeps its link, and its why_not, through a reopen', () => {
    const map = fold(log(card('a'), option('a:opt0'), link('a:opt0', 'a', 'alternative_to'), { type: 'decided', id: 'a' }, { type: 'reopened', id: 'a', why: 'new facts' }))
    expect(map.links).toContainEqual({ from: 'a:opt0', to: 'a', type: 'alternative_to', why: '', seq: 3 })
    expect(map.cards['a:opt0']!.whyNot).toBe('not a:opt0')
  })

  test('a decide clears the stale and review marks: the card is rederived', () => {
    const map = fold(
      log(card('a'), card('b'), source('s'), link('b', 'a', 'depends_on'), link('b', 's', 'supported_by'), { type: 'decided', id: 'b' }, { type: 'edited', id: 'a', field: 'body', text: 'x' }, {
        type: 'disputed',
        id: 's',
        why: 'w',
      }, { type: 'decided', id: 'b' }),
    )
    expect(map.problems).toEqual([])
    expect(map.cards.b).toMatchObject({ status: 'decided', decidedAt: 9, stale: [], review: [] })
  })
})

describe('the rules of the map', () => {
  const base = fold(log(card('a'), card('b'), option('o'), source('s'), link('b', 'a', 'refines'), link('o', 'a', 'alternative_to')))
  const cases: [string, EventBody, string][] = [
    ['an option with a second link', link('o', 'b', 'alternative_to'), 'option #o already has its alternative_to link'],
    ['an option that refines', link('o', 'b', 'refines'), 'an option has one link only: alternative_to, not refines'],
    ['an option as a target', link('b', 'o', 'depends_on'), 'an option has one link only, so #o cannot be the target of depends_on'],
    ['a card as an alternative', link('b', 'a', 'alternative_to'), 'only an option can be an alternative_to a card'],
    ['supported_by a card', link('a', 'b', 'supported_by'), 'supported_by points at a source, and #b is a card'],
    ['a second parent', link('b', 's', 'refines'), '#b already refines a parent'],
    ['a cycle', link('a', 'b', 'refines'), '#a refines #b would make a cycle'],
    ['a self link', link('a', 'a', 'depends_on'), '#a cannot link to itself'],
    ['a duplicate link', link('b', 'a', 'refines'), '#b already refines #a'],
    ['an unknown link type', { type: 'linked', from: 'a', to: 'b', link: 'blocks' as 'refines' }, 'unknown link type: blocks'],
    ['an unknown card', { type: 'decided', id: 'zz' }, 'no card #zz'],
    ['a duplicate id', card('a'), '#a already exists'],
    ['an empty id', card(''), 'a card needs an id'],
    ['an unknown kind', { type: 'added', id: 'k', kind: 'note' as 'card', title: 'k' }, 'unknown kind: note'],
    ['an empty title', card('t', ''), '#t needs a title'],
    ['an empty retitle', { type: 'retitled', id: 'a', title: '' }, '#a needs a title'],
    ['an unknown field', { type: 'edited', id: 'a', field: 'colour' as 'body', text: 'x' }, 'unknown field: colour'],
    ['a reopen of an open card', { type: 'reopened', id: 'a', why: 'x' }, '#a is not decided'],
    ['a restore of a card in the map', { type: 'restored', id: 'a' }, '#a is not removed'],
    ['an excerpt with no author', { type: 'said', id: 'a', who: '', text: 'x' }, 'an excerpt needs its text and who said it'],
    ['an unknown event type', { type: 'merged', id: 'a' } as unknown as EventBody, 'unknown event type: merged'],
    ['an unknown event type with no id', { type: 'merged' } as unknown as EventBody, 'unknown event type: merged'],
    ['a dispute on a card', { type: 'disputed', id: 'a', why: 'x' }, '#a is not a source'],
  ]
  for (const [name, event, message] of cases) {
    test(`refuses ${name}`, () => expect(check(base, event)).toBe(message))
  }

  test('refuses an alternative_to that points at a source', () => {
    const map = fold(log(option('o'), source('s')))
    expect(check(map, link('o', 's', 'alternative_to'))).toBe('an option is an alternative_to a card, and #s is a source')
  })

  test('refuses a second decide and a second remove', () => {
    const map = fold(log(card('a'), { type: 'decided', id: 'a' }, { type: 'removed', id: 'a' }))
    expect(check(map, { type: 'decided', id: 'a' })).toBe('#a is already decided')
    expect(check(map, { type: 'removed', id: 'a' })).toBe('#a is already removed')
  })

  test('a refused event goes into problems and the rest of the log still folds', () => {
    const map = fold(log(card('a'), card('a', 'again'), card('b')))
    expect(map.problems).toEqual([{ seq: 2, message: '#a already exists' }])
    expect(map.cards.a!.title).toBe('a')
    expect(Object.keys(map.cards)).toEqual(['a', 'b'])
  })
})

describe('the proof on a card (#vi-detail)', () => {
  test('excerpts collect in order, with who said them', () => {
    const map = fold(log(card('a'), { type: 'said', id: 'a', who: 'Eryk', text: 'one' }, { type: 'said', id: 'a', who: 'agent', text: 'two' }))
    expect(map.cards.a!.says).toEqual([
      { who: 'Eryk', text: 'one', seq: 2 },
      { who: 'agent', text: 'two', seq: 3 },
    ])
  })
})

describe('what changed after a card was decided', () => {
  test('lists later events on the card and on what it depends_on, in log order', () => {
    const events = log(card('a'), card('b'), card('c'), link('a', 'b', 'depends_on'), { type: 'decided', id: 'a' }, { type: 'retitled', id: 'c', title: 'C' }, {
      type: 'edited',
      id: 'b',
      field: 'body',
      text: 'x',
    }, { type: 'said', id: 'a', who: 'w', text: 't' })
    expect(changesSinceDecided(events, 'a').map((e) => e.seq)).toEqual([7, 8])
  })

  test('is empty for a card that was never decided', () => {
    expect(changesSinceDecided(log(card('a')), 'a')).toEqual([])
  })
})
