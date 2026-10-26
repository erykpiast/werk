import { describe, expect, test } from 'bun:test'
import type { EventBody, LogEvent } from './events.ts'
import { changesSinceDecided, check, fold, type Mark } from './fold.ts'

const AT = '2026-10-19T00:00:00.000Z'

/** Gives each body its place in the log, from 1. */
const log = (...bodies: EventBody[]): LogEvent[] => bodies.map((body, i) => ({ ...body, seq: i + 1, at: AT }))

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
    expect(map.cards.c!.stale).toEqual([{ because: 'p', seq: 6, at: AT, change: 'retitled', via: 'refines', path: [] }])
    expect(map.cards.g!.stale).toEqual([])
    expect(map.cards.p!.stale).toEqual([])
  })

  test('depends_on: a change marks the dependent stale, one hop, and not the one behind it', () => {
    const map = fold(
      log(card('a'), card('b'), card('c'), link('b', 'a', 'depends_on'), link('c', 'b', 'depends_on'), { type: 'decided', id: 'a' }, {
        type: 'reopened',
        id: 'a',
        reason: 'rejected',
        why: 'wrong',
      }),
    )
    expect(map.cards.b!.stale).toEqual([{ because: 'a', seq: 7, at: AT, change: 'reopened', reason: 'rejected', via: 'depends_on', path: [], why: 'wrong' }])
    expect(map.cards.c!.stale).toEqual([])
    expect(map.cards.a!.status).toBe('open')
  })

  test('a link made after a change carries no mark from it', () => {
    const map = fold(log(card('a'), card('b'), { type: 'retitled', id: 'a', title: 'A' }, link('b', 'a', 'depends_on')))
    expect(map.cards.b!.stale).toEqual([])
  })

  test('supported_by: a dispute flags the card for review and never marks it stale', () => {
    const map = fold(log(card('a'), source('s'), link('a', 's', 'supported_by'), { type: 'disputed', id: 's', why: 'the numbers are old' }))
    expect(map.cards.a!.review).toEqual([{ because: 's', seq: 4, at: AT, change: 'disputed', via: 'supported_by', path: [], why: 'the numbers are old' }])
    expect(map.cards.a!.stale).toEqual([])
  })

  test('alternative_to: an option keeps its link, and its why_not, through a reopen', () => {
    const map = fold(log(card('a'), option('a:opt0'), link('a:opt0', 'a', 'alternative_to'), { type: 'decided', id: 'a' }, { type: 'reopened', id: 'a', reason: 'rejected', why: 'new facts' }))
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
    ['supported_by a card', link('a', 'b', 'supported_by'), 'supported_by points at a source or an excerpt, and #b is a card'],
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
    ['a reopen of an open card', { type: 'reopened', id: 'a', reason: 'postponed', why: 'x' }, '#a is not decided'],
    ['a reopen with no reason', { type: 'reopened', id: 'a', why: 'x' } as unknown as EventBody, 'a reopen needs a reason: postponed or rejected'],
    ['a reopen with an unknown reason', { type: 'reopened', id: 'a', reason: 'invalidated', why: 'x' } as unknown as EventBody, 'a reopen needs a reason: postponed or rejected'],
    ['a restore of a card in the map', { type: 'restored', id: 'a' }, '#a is not removed'],
    ['an excerpt with no author', { type: 'said', id: 'a', who: '', text: 'x' }, 'an excerpt needs its text and who said it'],
    ['an unknown event type', { type: 'merged', id: 'a' } as unknown as EventBody, 'unknown event type: merged'],
    ['an unknown event type with no id', { type: 'merged' } as unknown as EventBody, 'unknown event type: merged'],
    ['a dispute on a card', { type: 'disputed', id: 'a', why: 'x' }, '#a is not a source'],
    ['an unknown who on add', { type: 'added', id: 'w', kind: 'card', title: 'w', who: 'them' as 'you' }, 'unknown who: them'],
    ['an add with a parent and an alternative', { type: 'added', id: 'x', kind: 'option', title: 'x', parent: 'a', alternativeTo: 'a' }, '#x cannot both refine a card and be an alternative_to one'],
    ['an option for a missing card', { type: 'added', id: 'x', kind: 'option', title: 'x', alternativeTo: 'zz' }, 'no card #zz'],
    ['a card added as an alternative', { type: 'added', id: 'x', kind: 'card', title: 'x', alternativeTo: 'a' }, 'only an option can be an alternative_to a card'],
    ['an unknown fact', { type: 'recorded', id: 'a', fact: 'colour' as 'who', value: 'x' }, 'unknown fact: colour'],
    ['an empty record', { type: 'recorded', id: 'a', fact: 'noBasis', value: '' }, '#a: a record of noBasis needs a value'],
    ['an unknown who', { type: 'recorded', id: 'a', fact: 'who', value: 'them' }, 'who is one of you, me, prototype, got them'],
    ['an empty kill criterion', { type: 'killAdded', id: 'a', text: '' }, '#a: a kill criterion needs its text'],
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

describe('the contract facts are records in the log (#werk-contract-facts)', () => {
  test('a new card has no facts: no who, no waiver, no kill criterion', () => {
    const a = fold(log(card('a'))).cards.a!
    expect(a.kill).toEqual([])
    expect(a.who).toBeUndefined()
    expect(a.noBasis).toBeUndefined()
    expect(a.unchallenged).toBeUndefined()
  })

  test('who can come with the add, and a later record replaces it', () => {
    const map = fold(log({ type: 'added', id: 'a', kind: 'card', title: 'a', who: 'me' }, { type: 'recorded', id: 'a', fact: 'who', value: 'you' }))
    expect(map.cards.a!.who).toBe('you')
  })

  test('the waivers keep their written reason, and kill criteria add up in order', () => {
    const map = fold(
      log(
        card('a'),
        { type: 'recorded', id: 'a', fact: 'noBasis', value: 'the root' },
        { type: 'recorded', id: 'a', fact: 'unchallenged', value: 'one way only' },
        { type: 'killAdded', id: 'a', text: 'first' },
        { type: 'killAdded', id: 'a', text: 'second' },
      ),
    )
    expect(map.cards.a).toMatchObject({ noBasis: 'the root', unchallenged: 'one way only', kill: ['first', 'second'] })
  })

  test('a record and a kill criterion mark no other card', () => {
    const map = fold(log(card('a'), card('b'), link('b', 'a', 'depends_on'), { type: 'recorded', id: 'a', fact: 'who', value: 'me' }, { type: 'killAdded', id: 'a', text: 'k' }))
    expect(map.cards.b!.stale).toEqual([])
  })

  test('an option added with alternativeTo is linked to its card in the same event', () => {
    const map = fold(log(card('a'), { type: 'added', id: 'a:opt0', kind: 'option', title: 'O', alternativeTo: 'a' }))
    expect(map.links).toEqual([{ from: 'a:opt0', to: 'a', type: 'alternative_to', why: '', seq: 2 }])
  })
})

describe('a card added under a parent (one event)', () => {
  const under = (id: string, parent: string, kind: 'card' | 'option' = 'card'): EventBody => ({ type: 'added', id, kind, title: id, parent })

  test('the added event places the card: its refines link has the same place in the log', () => {
    const map = fold(log(card('a'), under('b', 'a')))
    expect(map.seq).toBe(2)
    expect(map.links).toEqual([{ from: 'b', to: 'a', type: 'refines', why: '', seq: 2 }])
    expect(map.cards.b).toMatchObject({ title: 'b', status: 'open' })
  })

  test('refuses a missing parent, an option under a parent, and a duplicate id', () => {
    const base = fold(log(card('a'), option('o'), link('o', 'a', 'alternative_to')))
    expect(check(base, under('b', 'zz'))).toBe('no card #zz')
    expect(check(base, under('o2', 'a', 'option'))).toBe('an option has one link only: alternative_to, not refines')
    expect(check(base, under('x', 'o'))).toBe('an option has one link only, so #o cannot be the target of refines')
    expect(check(base, under('a', 'a'))).toBe('#a already exists')
  })

  test('a refused add leaves no card and no link', () => {
    const map = fold(log(card('a'), under('b', 'zz')))
    expect(map.cards.b).toBeUndefined()
    expect(map.links).toEqual([])
    expect(map.problems).toEqual([{ seq: 2, message: 'no card #zz' }])
  })
})

describe('the fold is pure', () => {
  test('the same events give the same map, and the events are not changed', () => {
    const events = log(card('a'), card('b'), link('b', 'a', 'refines'), { type: 'retitled', id: 'a', title: 'A2' })
    const copy = structuredClone(events)
    expect(fold(events)).toEqual(fold(copy))
    expect(events).toEqual(copy)
  })

  test('folding a longer log does not change a map folded before', () => {
    const events = log(card('a'), { type: 'retitled', id: 'a', title: 'A2' })
    const before = fold(events.slice(0, 1))
    const snapshot = structuredClone(before)
    fold(events)
    expect(before).toEqual(snapshot)
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

describe('a ghost: a proposed node waits for the accept (#werk-propose-new)', () => {
  const ghost = (id: string, extra: Partial<Extract<EventBody, { type: 'proposed' }>> = {}): EventBody => ({ type: 'proposed', id, kind: 'card', title: id, ...extra })
  const accept = (id: string): EventBody => ({ type: 'accepted', id })
  const discard = (id: string): EventBody => ({ type: 'discarded', id })

  test('a proposed node is a ghost in the fold, and its edge is held, not live', () => {
    const map = fold(log(card('a'), ghost('b', { parent: 'a' })))
    expect(map.cards.b).toMatchObject({ proposed: true, status: 'open' })
    expect(map.links).toEqual([])
    expect(map.ghostEdges).toEqual([{ from: 'b', to: 'a', type: 'refines', why: '', seq: 2 }])
  })

  test('each kind proposes: card, option, source and excerpt', () => {
    const map = fold(
      log(card('a'), ghost('a:opt0', { kind: 'option', alternativeTo: 'a', whyNot: 'slow' }), ghost('s', { kind: 'source' }), ghost('e', { kind: 'excerpt', body: 'keep every change' })),
    )
    expect(['a:opt0', 's', 'e'].map((id) => map.cards[id]!.proposed)).toEqual([true, true, true])
    expect(map.problems).toEqual([])
  })

  test('accepting a ghost child whose parent is a ghost makes both real, and their edges live', () => {
    const map = fold(log(card('a'), ghost('b', { parent: 'a' }), ghost('c', { parent: 'b' }), accept('c')))
    expect(map.cards.b!.proposed).toBeUndefined()
    expect(map.cards.c!.proposed).toBeUndefined()
    expect(map.links.map((l) => [l.from, l.to, l.seq])).toEqual([
      ['b', 'a', 2],
      ['c', 'b', 3],
    ])
    expect(map.ghostEdges).toEqual([])
  })

  test('an accept stops at the first real parent and leaves a ghost sibling alone', () => {
    const map = fold(log(card('a'), ghost('b', { parent: 'a' }), ghost('b2', { parent: 'a' }), accept('b')))
    expect(map.cards.b!.proposed).toBeUndefined()
    expect(map.cards.b2!.proposed).toBe(true)
  })

  test('an accept takes the ghost options and evidence of the card, never a depends_on target', () => {
    const map = fold(
      log(
        card('a'),
        ghost('b', { parent: 'a' }),
        ghost('b:opt0', { kind: 'option', alternativeTo: 'b', whyNot: 'slow' }),
        ghost('s', { kind: 'source' }),
        ghost('e', { kind: 'excerpt' }),
        ghost('d'),
        link('b', 's', 'supported_by'),
        link('b', 'e', 'supported_by'),
        link('b', 'd', 'depends_on'),
        accept('b'),
      ),
    )
    expect(['b', 'b:opt0', 's', 'e'].map((id) => map.cards[id]!.proposed)).toEqual([undefined, undefined, undefined, undefined])
    expect(map.cards.d!.proposed).toBe(true)
    expect(map.ghostEdges).toEqual([{ from: 'b', to: 'd', type: 'depends_on', why: '', seq: 9 }])
  })

  test('a held edge goes live with no event of its own when its last ghost end is accepted', () => {
    const events = log(card('a'), ghost('b', { parent: 'a' }), ghost('d', { parent: 'a' }), link('b', 'd', 'depends_on'), accept('b'), accept('d'))
    expect(fold(events.slice(0, 5)).ghostEdges.filter((l) => l.type === 'depends_on')).toEqual([{ from: 'b', to: 'd', type: 'depends_on', why: '', seq: 4 }])
    const map = fold(events)
    expect(map.links.find((l) => l.type === 'depends_on')).toEqual({ from: 'b', to: 'd', type: 'depends_on', why: '', seq: 4 })
    expect(map.ghostEdges).toEqual([])
    expect(map.seq).toBe(6)
  })

  test('discarding a ghost parent drops its ghost children and options, and the id is free again', () => {
    const map = fold(
      log(card('a'), ghost('b', { parent: 'a' }), ghost('c', { parent: 'b' }), ghost('c:opt0', { kind: 'option', alternativeTo: 'c' }), ghost('x'), link('x', 'b', 'depends_on'), discard('b')),
    )
    expect(Object.keys(map.cards)).toEqual(['a', 'x'])
    expect(map.ghostEdges).toEqual([])
    const again = fold(log(card('a'), ghost('b', { parent: 'a' }), discard('b'), ghost('b', { parent: 'a', title: 'B, fixed' })))
    expect(again.problems).toEqual([])
    expect(again.cards.b).toMatchObject({ title: 'B, fixed', proposed: true })
  })

  test('the words of a ghost are frozen: a second add, a retitle and an edit all refuse', () => {
    const map = fold(log(card('a'), ghost('b')))
    const frozen = '#b is a proposal, and its words are frozen. To change them, discard it and propose it again.'
    for (const event of [ghost('b', { title: 'again' }), card('b'), { type: 'retitled', id: 'b', title: 'B2' }, { type: 'edited', id: 'b', field: 'body', text: 'x' }, { type: 'edited', id: 'b', field: 'why', text: 'x' }] as EventBody[]) {
      expect(check(map, event)).toBe(frozen)
    }
  })

  test('a link, a status, the who and a kill criterion still work on a ghost', () => {
    const map = fold(
      log(card('a'), ghost('b'), link('b', 'a', 'depends_on'), { type: 'recorded', id: 'b', fact: 'who', value: 'me' }, { type: 'killAdded', id: 'b', text: 'k' }, { type: 'decided', id: 'b' }, {
        type: 'reopened',
        id: 'b',
        reason: 'rejected',
        why: 'again',
      }),
    )
    expect(map.problems).toEqual([])
    expect(map.cards.b).toMatchObject({ proposed: true, who: 'me', kill: ['k'], status: 'open' })
  })

  test('a ghost is not removed or restored, and only a ghost is accepted or discarded', () => {
    const map = fold(log(card('a'), ghost('b')))
    expect(check(map, { type: 'removed', id: 'b' })).toBe('#b is a proposal: discard it, it is not in the map to remove')
    expect(check(map, { type: 'restored', id: 'b' })).toBe('#b is a proposal: discard it, it is not in the map to remove')
    expect(check(map, accept('a'))).toBe('#a is not a proposal')
    expect(check(map, discard('a'))).toBe('#a is not a proposal')
    expect(check(map, accept('zz'))).toBe('no card #zz')
  })

  test('a link is checked against the held edges too', () => {
    const map = fold(log(card('a'), card('p'), ghost('b', { parent: 'a' }), ghost('o', { kind: 'option', alternativeTo: 'a' })))
    expect(check(map, link('b', 'p', 'refines'))).toBe('#b already refines a parent')
    expect(check(map, link('b', 'a', 'refines'))).toBe('#b already refines #a')
    expect(check(map, link('o', 'p', 'alternative_to'))).toBe('option #o already has its alternative_to link')
  })

  test('the marks and the live edges are the same before and after ghosts are added', () => {
    const base = [card('a'), card('b'), link('b', 'a', 'depends_on'), { type: 'decided', id: 'a' }] as EventBody[]
    const ghosts = [ghost('g', { parent: 'a' }), ghost('h'), link('h', 'a', 'depends_on'), ghost('a:opt0', { kind: 'option', alternativeTo: 'a' }), link('b', 'h', 'depends_on')] as EventBody[]
    const real = (events: EventBody[]) => {
      const map = fold(log(...events))
      expect(map.problems).toEqual([])
      const unseq = (marks: Mark[]) => marks.map(({ seq: _seq, ...m }) => m)
      const cards = Object.values(map.cards)
        .filter((c) => !c.proposed)
        .map(({ reopen, ...c }) => ({ ...c, reopen: reopen && { ...reopen, seq: 0 }, stale: unseq(c.stale), paused: unseq(c.paused) }))
      return { cards, links: map.links.map(({ seq: _seq, ...l }) => l) }
    }
    expect(real([...base, ...ghosts])).toEqual(real(base))
    for (const reason of ['rejected', 'postponed'] as const) {
      const change = { type: 'reopened', id: 'a', reason, why: 'new facts' } as EventBody
      const before = real([...base, change])
      expect(before.cards.find((c) => c.id === 'b')![reason === 'rejected' ? 'stale' : 'paused']).toHaveLength(1)
      expect(real([...base, ...ghosts, change])).toEqual(before)
      const map = fold(log(...base, ...ghosts, change))
      for (const id of ['g', 'h']) expect(map.cards[id]).toMatchObject({ stale: [], paused: [] })
    }
  })
})
