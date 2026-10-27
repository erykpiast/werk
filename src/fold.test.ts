import { describe, expect, test } from 'bun:test'
import { fold, toJSON } from './fold.ts'
import { acceptClosure, childrenOf, discardClosure, parentOf, planRemoval, removalSet } from './stage.ts'
import type { Event, EventType } from './types.ts'

/** A log, written the way the CLI writes one. seq and at are assigned here. */
function log(...events: Array<[EventType, Record<string, unknown>]>): Event[] {
  return events.map(([type, payload], i) => ({
    seq: i + 1,
    at: `2026-09-22T10:${String(i).padStart(2, '0')}:00.000Z`,
    actor: 'agent' as const,
    type,
    payload,
  }))
}

const card = (id: string, extra: Record<string, unknown> = {}) =>
  ['node.added', { id, kind: 'card', title: id, status: 'open', ...extra }] as [EventType, Record<string, unknown>]
const ghost = (id: string, extra: Record<string, unknown> = {}) =>
  ['node.proposed', { id, kind: 'card', title: id, status: 'open', ...extra }] as [EventType, Record<string, unknown>]
const edge = (from: string, to: string, type = 'refines') =>
  ['edge.added', { from, to, type }] as [EventType, Record<string, unknown>]

describe('a proposed node', () => {
  test('is in nodes, flagged, and out of the live edge list', () => {
    const g = fold(log(card('root'), ghost('kid'), edge('kid', 'root')))
    expect(g.nodes.has('kid')).toBe(true)
    expect(g.proposed.has('kid')).toBe(true)
    expect(g.edges).toEqual([])
    expect(g.ghostEdges).toEqual([{ from: 'kid', to: 'root', type: 'refines' }])
  })

  test('counts in no rollup', () => {
    const g = fold(log(card('root'), ghost('kid'), edge('kid', 'root')))
    expect(g.rollup.get('root')!.cards).toBe(1)
    expect(g.rollup.has('kid')).toBe(false)
  })

  test('is never flagged unchallenged, decided or not', () => {
    const g = fold(log(ghost('c', { who: 'you', status: 'decided' })))
    expect([...g.unchallenged]).toEqual([])
  })

  test('is frozen: a second propose of the same id changes nothing', () => {
    const g = fold(log(ghost('c', { title: 'first' }), ghost('c', { title: 'second' })))
    expect(g.nodes.get('c')!.title).toBe('first')
  })

  test('goes live on accept, and takes its held edges with it', () => {
    const g = fold(log(card('root'), ghost('kid'), edge('kid', 'root'), ['change.accepted', { id: 'kid' }]))
    expect(g.proposed.size).toBe(0)
    expect(g.edges).toEqual([{ from: 'kid', to: 'root', type: 'refines' }])
    expect(g.ghostEdges).toEqual([])
    expect(g.rollup.get('root')!.cards).toBe(2)
  })

  test('leaves nothing behind on discard, and the id is free again', () => {
    const g = fold(
      log(
        card('root'),
        ghost('kid', { title: 'wrong' }),
        edge('kid', 'root'),
        ['change.discarded', { id: 'kid' }],
        ghost('kid', { title: 'right' }),
      ),
    )
    expect(g.nodes.get('kid')!.title).toBe('right')
    expect(g.proposed.has('kid')).toBe(true)
    expect(g.edges).toEqual([])
  })

  test('a staged edit on a real card still accepts as an edit, not as a node', () => {
    const g = fold(
      log(
        card('c', { body: 'one' }),
        ['change.proposed', { id: 'c', title: 'two' }],
        ['change.accepted', { id: 'c' }],
      ),
    )
    expect(g.nodes.get('c')!.title).toBe('two')
    expect(g.nodes.get('c')!.pending).toBeUndefined()
  })
})

describe('a card added under a parent (#pr-log-one-event)', () => {
  test('one event places it: the refines edge is held, then goes live on accept', () => {
    const held = log(card('root'), ghost('kid', { parent: 'root' }))
    const g = fold(held)
    expect(g.ghostEdges).toEqual([{ from: 'kid', to: 'root', type: 'refines' }])
    expect(g.nodes.get('kid')!).not.toHaveProperty('parent')
    const live = fold(log(card('root'), ghost('kid', { parent: 'root' }), ['change.accepted', { id: 'kid' }]))
    expect(live.edges).toEqual([{ from: 'kid', to: 'root', type: 'refines' }])
    expect(live.rollup.get('root')!.cards).toBe(2)
  })

  test('folds the same as an old log with a separate link event', () => {
    const one = fold(log(card('root'), ghost('kid', { parent: 'root' })))
    const two = fold(log(card('root'), ghost('kid'), edge('kid', 'root')))
    expect(one.ghostEdges).toEqual(two.ghostEdges)
  })

  test('a direct add with a parent places it too', () => {
    const g = fold(log(card('root'), card('kid', { parent: 'root' })))
    expect(g.edges).toEqual([{ from: 'kid', to: 'root', type: 'refines' }])
  })

  test('an excerpt whose span is not as long as its words is set aside (#werk-excerpt-event-span)', () => {
    const ex = (span: unknown, msgIndex: unknown = 0) =>
      ['node.proposed', { id: 'c:ex0', kind: 'excerpt', title: 'w', text: 'seats', msgIndex, span, citedBy: 'c' }] as [EventType, Record<string, unknown>]
    expect(fold(log(card('c'), ex([0, 5]))).nodes.has('c:ex0')).toBe(true)
    expect(fold(log(card('c'), ex([0, 4]))).nodes.has('c:ex0')).toBe(false)
    expect(fold(log(card('c'), ex([-1, 4]))).nodes.has('c:ex0')).toBe(false)
    expect(fold(log(card('c'), ex([0, 5], 1.5))).nodes.has('c:ex0')).toBe(false)
    expect(fold(log(card('c'), ex([0, 4]))).ghostEdges).toEqual([])
  })

  test('a quote that marks its pointer whole is set aside when a part is missing (#werk-excerpt-event-shape)', () => {
    const base = { id: 'c:ex0', kind: 'excerpt', title: 'w', text: 'seats', msgIndex: 0, span: [0, 5], citedBy: 'c' }
    const whole = { ...base, pointerWhole: true, conversation: 'main', session: 's', speaker: 'you', saidAt: 't' }
    const ev = (p: Record<string, unknown>) => ['node.proposed', p] as [EventType, Record<string, unknown>]
    expect(fold(log(card('c'), ev(whole))).nodes.has('c:ex0')).toBe(true)
    for (const k of ['conversation', 'session', 'speaker', 'saidAt']) {
      expect(fold(log(card('c'), ev({ ...whole, [k]: undefined }))).nodes.has('c:ex0')).toBe(false)
    }
    // An older excerpt has no mark, so a missing part does not stop it loading.
    expect(fold(log(card('c'), ev(base))).nodes.has('c:ex0')).toBe(true)
  })

  test('discard takes the parent with it, so a new proposal sits only where it says', () => {
    const g = fold(
      log(
        card('a'),
        card('b'),
        ghost('kid', { parent: 'a' }),
        ['change.discarded', { id: 'kid' }],
        ghost('kid', { parent: 'b' }),
      ),
    )
    expect(g.ghostEdges).toEqual([{ from: 'kid', to: 'b', type: 'refines' }])
  })

  test('a quote is one event: the excerpt and its held supported_by link from the citing card', () => {
    const quote = ['node.proposed', { id: 'c:ex0', kind: 'excerpt', title: 'w', text: 'w', msgIndex: 0, span: [0, 1], citedBy: 'c' }] as [EventType, Record<string, unknown>]
    const g = fold(log(card('c'), quote))
    expect(g.ghostEdges).toEqual([{ from: 'c', to: 'c:ex0', type: 'supported_by' }])
    expect(g.nodes.get('c:ex0')!).not.toHaveProperty('citedBy')
    expect(fold(log(card('c'), quote, ['change.accepted', { id: 'c:ex0' }])).edges).toEqual([{ from: 'c', to: 'c:ex0', type: 'supported_by' }])
    const gone = fold(log(card('c'), quote, ['change.discarded', { id: 'c:ex0' }]))
    expect([gone.edges, gone.ghostEdges, gone.nodes.has('c:ex0')]).toEqual([[], [], false])
  })

  test('a second propose of the same id does not move it', () => {
    const g = fold(log(card('a'), card('b'), ghost('kid', { parent: 'a' }), ghost('kid', { parent: 'b' })))
    expect(g.ghostEdges).toEqual([{ from: 'kid', to: 'a', type: 'refines' }])
  })
})

describe('a removed node', () => {
  test('leaves the map, keeps its place in the log, and takes its edges', () => {
    const g = fold(log(card('root'), card('kid'), edge('kid', 'root'), ['node.removed', { id: 'kid' }]))
    expect(g.nodes.has('kid')).toBe(false)
    expect(g.edges).toEqual([])
    expect(g.removed.map((r) => r.id)).toEqual(['kid'])
    expect(g.rollup.get('root')!.cards).toBe(1)
  })

  test('comes back whole when restored', () => {
    const g = fold(
      log(card('root'), card('kid'), edge('kid', 'root'), ['node.removed', { id: 'kid' }], ['node.restored', { id: 'kid' }]),
    )
    expect(g.nodes.has('kid')).toBe(true)
    expect(g.edges).toEqual([{ from: 'kid', to: 'root', type: 'refines' }])
    expect(g.removed).toEqual([])
  })

  test('a link waits until both of its ends are back, in any order', () => {
    const l = edge('login', 'session', 'depends_on')
    const base = [card('root'), card('login'), card('session'), l]
    const out = (id: string): [EventType, Record<string, unknown>] => ['node.removed', { id }]
    const back = (id: string): [EventType, Record<string, unknown>] => ['node.restored', { id }]
    const linked = (g: ReturnType<typeof fold>) => g.edges.some((e) => e.from === 'login' && e.to === 'session')

    expect(linked(fold(log(...base, out('login'), out('session'))))).toBe(false)
    expect(linked(fold(log(...base, out('login'), out('session'), back('login'))))).toBe(false)
    expect(linked(fold(log(...base, out('login'), out('session'), back('login'), back('session'))))).toBe(true)
    expect(linked(fold(log(...base, out('login'), out('session'), back('session'), back('login'))))).toBe(true)
  })

  test('makes nothing stale when the card it depended on is removed', () => {
    const g = fold(
      log(
        card('a'),
        card('b'),
        edge('b', 'a', 'depends_on'),
        ['reopened', { id: 'a', reason: 'invalidated' }],
        ['node.removed', { id: 'a' }],
      ),
    )
    expect([...g.stale]).toEqual([])
  })

  test('lists newest first', () => {
    const g = fold(log(card('a'), card('b'), ['node.removed', { id: 'a' }], ['node.removed', { id: 'b' }]))
    expect(g.removed.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('what one click takes with it', () => {
  // A ghost under a ghost under a real card, with an option on the child.
  const chain = () =>
    fold(
      log(
        card('root'),
        ghost('mid'),
        edge('mid', 'root'),
        ghost('leaf'),
        edge('leaf', 'mid'),
        ['node.proposed', { id: 'leaf:opt0', kind: 'option', title: 'no' }],
        edge('leaf:opt0', 'leaf', 'alternative_to'),
        ghost('other'),
        edge('leaf', 'other', 'depends_on'),
      ),
    )

  test('accept pulls the ghost parents down from the top, plus the card own options', () => {
    expect(acceptClosure(chain(), 'leaf')).toEqual(['mid', 'leaf', 'leaf:opt0'])
  })

  test('accept never pulls in a depends_on target: that is another card', () => {
    expect(acceptClosure(chain(), 'leaf')).not.toContain('other')
  })

  test('accept of a lone ghost is just that ghost', () => {
    expect(acceptClosure(chain(), 'other')).toEqual(['other'])
  })

  test('discard takes the ghost children, so none is left hanging', () => {
    expect(discardClosure(chain(), 'mid').sort()).toEqual(['leaf', 'leaf:opt0', 'mid'])
  })

  // C and D both cite source S. Only C cites source T and excerpt C:ex0. #werk-propose-new-carry.
  const evidence = () =>
    fold(
      log(
        card('root'),
        ghost('C', { parent: 'root' }),
        ghost('D', { parent: 'root' }),
        ['node.proposed', { id: 'S', kind: 'source', title: 'Pricing survey' }],
        ['node.proposed', { id: 'T', kind: 'source', title: 'Churn study' }],
        ['node.proposed', { id: 'C:ex0', kind: 'excerpt', title: 'per seat', text: 'per seat', msgIndex: 0, span: [0, 8] }],
        edge('C', 'S', 'supported_by'),
        edge('D', 'S', 'supported_by'),
        edge('C', 'T', 'supported_by'),
        edge('C', 'C:ex0', 'supported_by'),
      ),
    )

  test('accept takes the ghost sources and excerpts the card cites', () => {
    expect(acceptClosure(evidence(), 'C')).toEqual(['C', 'S', 'T', 'C:ex0'])
  })

  test('accept of a ghost source does not take the cards that cite it', () => {
    expect(acceptClosure(evidence(), 'S')).toEqual(['S'])
  })

  test('discard drops the evidence only the dropped card cites, and keeps what another card cites', () => {
    expect(discardClosure(evidence(), 'C').sort()).toEqual(['C', 'C:ex0', 'T'])
  })

  test('discard keeps a ghost source that a real card cites', () => {
    const g = fold(
      log(
        card('A'),
        ghost('C'),
        ['node.proposed', { id: 'S', kind: 'source', title: 'S' }],
        edge('C', 'S', 'supported_by'),
        edge('A', 'S', 'supported_by'),
      ),
    )
    expect(discardClosure(g, 'C')).toEqual(['C'])
  })

  test('discard of a ghost source does not take the cards that cite it', () => {
    expect(discardClosure(evidence(), 'S')).toEqual(['S'])
  })

  test('after discard C and accept D, S is real and D shows it as live proof', () => {
    const before = evidence()
    const events = [
      ...log(
        card('root'),
        ghost('C', { parent: 'root' }),
        ghost('D', { parent: 'root' }),
        ['node.proposed', { id: 'S', kind: 'source', title: 'Pricing survey' }],
        ['node.proposed', { id: 'T', kind: 'source', title: 'Churn study' }],
        ['node.proposed', { id: 'C:ex0', kind: 'excerpt', title: 'per seat', text: 'per seat', msgIndex: 0, span: [0, 8] }],
        edge('C', 'S', 'supported_by'),
        edge('D', 'S', 'supported_by'),
        edge('C', 'T', 'supported_by'),
        edge('C', 'C:ex0', 'supported_by'),
        ...discardClosure(before, 'C').map((id) => ['change.discarded', { id }] as [EventType, Record<string, unknown>]),
      ),
    ]
    const mid = fold(events)
    expect([...mid.proposed].sort()).toEqual(['D', 'S'])
    const accepted = acceptClosure(mid, 'D').map((id, i) => ({
      seq: events.length + i + 1,
      at: '2026-09-22T11:00:00.000Z',
      actor: 'you' as const,
      type: 'change.accepted' as EventType,
      payload: { id },
    }))
    const after = fold([...events, ...accepted])
    expect(after.proposed.size).toBe(0)
    expect(after.edges).toContainEqual({ from: 'D', to: 'S', type: 'supported_by' })
  })

  test('planRemoval: the subtree by default; with reparent, the children move up and stay', () => {
    const g = fold(log(card('what'), card('a'), edge('a', 'what'), card('b'), edge('b', 'a')))
    expect(planRemoval(g, 'a')).toEqual({ moves: [], ids: ['a', 'b'] })
    expect(planRemoval(g, 'a', true)).toEqual({ moves: [{ id: 'b', parent: 'what' }], ids: ['a'] })
    expect(() => planRemoval(g, 'what')).toThrow('the top card #what cannot be removed')
    // Children and no parent of its own: nowhere to lift them to.
    const orphan = fold(log(card('top'), card('kid'), edge('kid', 'top')))
    expect(() => planRemoval(orphan, 'top', true)).toThrow('no parent of its own')
  })

  test('a proposed removal waits as pending; accept clears it, and the node.removed events take the card out', () => {
    const g = fold(log(card('root'), card('a'), edge('a', 'root'), ['change.proposed', { id: 'a', remove: true, reparent: false }]))
    expect(g.nodes.get('a')!.pending).toEqual({ remove: true, reparent: false })
    const done = fold(
      log(
        card('root'),
        card('a'),
        edge('a', 'root'),
        ['change.proposed', { id: 'a', remove: true }],
        ['change.accepted', { id: 'a' }],
        ['node.removed', { id: 'a' }],
      ),
    )
    expect(done.nodes.has('a')).toBe(false)
  })

  test('remove takes the whole refines subtree', () => {
    const g = fold(log(card('root'), card('a'), edge('a', 'root'), card('b'), edge('b', 'a')))
    expect(removalSet(g, 'a').sort()).toEqual(['a', 'b'])
    expect(removalSet(g, 'b')).toEqual(['b'])
  })

  test('remove takes the options of what it removes — an orphan option is unreachable', () => {
    const g = fold(
      log(
        card('root'),
        card('a'),
        edge('a', 'root'),
        ['node.added', { id: 'a:opt0', kind: 'option', title: 'no' }],
        edge('a:opt0', 'a', 'alternative_to'),
      ),
    )
    expect(removalSet(g, 'a').sort()).toEqual(['a', 'a:opt0'])
    expect(removalSet(g, 'a', false).sort()).toEqual(['a', 'a:opt0'])
  })

  test('a source two cards cite survives while one of them does', () => {
    const g = fold(
      log(
        card('a'),
        card('b'),
        ['node.added', { id: 'src0', kind: 'source', title: 'paper' }],
        edge('a', 'src0', 'supported_by'),
        edge('b', 'src0', 'supported_by'),
      ),
    )
    expect(removalSet(g, 'a')).toEqual(['a'])
    const onlyOne = fold(log(card('a'), ['node.added', { id: 's', kind: 'source', title: 'p' }], edge('a', 's', 'supported_by')))
    expect(removalSet(onlyOne, 'a').sort()).toEqual(['a', 's'])
  })
})

describe('a card obligation (#st-build-card)', () => {
  const obligation = ['obligation.created', { id: 'b1', ticket: 'r/01', cites: ['root'] }] as [EventType, Record<string, unknown>]

  test('is unsatisfied until a card names it', () => {
    const g = fold(log(card('root'), obligation))
    expect(g.obligations.get('b1')).toMatchObject({ ticket: 'r/01', cites: ['root'], cards: [] })
  })

  test('a ghost card that names it satisfies it; a discarded one stops counting', () => {
    const named = ghost('d1', { obligation: 'b1' })
    expect(fold(log(card('root'), obligation, named)).obligations.get('b1')!.cards).toEqual(['d1'])
    const discarded = fold(log(card('root'), obligation, named, ['change.discarded', { id: 'd1' }]))
    expect(discarded.obligations.get('b1')!.cards).toEqual([])
  })

  test('a "no new decision" record closes it with the cards it names; the first record wins', () => {
    const first = ['obligation.followed', { id: 'b1', cards: ['root'] }] as [EventType, Record<string, unknown>]
    const second = ['obligation.followed', { id: 'b1', cards: ['other'] }] as [EventType, Record<string, unknown>]
    const g = fold(log(card('root'), obligation, first, second))
    expect(g.obligations.get('b1')).toMatchObject({ cards: [], followed: ['root'] })
  })
})

const ev = (type: EventType, payload: Record<string, unknown>) => [type, payload] as [EventType, Record<string, unknown>]

describe('edits to a live card', () => {
  test('retitle and body edit land, and a missing id is ignored', () => {
    const g = fold(
      log(
        card('a'),
        ev('node.retitled', { id: 'a', title: 'A' }),
        ev('node.bodyEdited', { id: 'a', body: 'one' }),
        ev('node.bodyEdited', { id: 'a', patch: { why: 'because', who: 'me' } }),
        ev('node.retitled', { id: 'ghost-of-nothing', title: 'x' }),
        ev('node.bodyEdited', { id: 'ghost-of-nothing', body: 'x' }),
        ev('status.set', { id: 'ghost-of-nothing', status: 'decided' }),
      ),
    )
    const a = g.nodes.get('a')!
    expect([a.title, a.body, a.why, a.who]).toEqual(['A', 'one', 'because', 'me'])
    expect(g.nodes.has('ghost-of-nothing')).toBe(false)
  })

  test('a duplicate edge is kept once, and an unlink takes it out', () => {
    const g = fold(log(card('a'), card('b'), edge('a', 'b', 'depends_on'), edge('a', 'b', 'depends_on')))
    expect(g.edges).toHaveLength(1)
    const gone = fold(log(card('a'), card('b'), edge('a', 'b', 'depends_on'), ev('edge.removed', { from: 'a', to: 'b', type: 'depends_on' }), ev('edge.removed', { from: 'x', to: 'y', type: 'refines' })))
    expect(gone.edges).toEqual([])
  })

  test('status.set changes the status', () => {
    expect(fold(log(card('a'), ev('status.set', { id: 'a', status: 'proto' }))).nodes.get('a')!.status).toBe('proto')
  })

  test('level.moved replaces the refines parent, and no parent leaves it a root', () => {
    const g = fold(log(card('p'), card('q'), card('a'), edge('a', 'p'), ev('level.moved', { id: 'a', parent: 'q' })))
    expect(g.edges).toEqual([{ from: 'a', to: 'q', type: 'refines' }])
    const root = fold(log(card('p'), card('a'), edge('a', 'p'), ev('level.moved', { id: 'a' })))
    expect(root.edges).toEqual([])
  })

  test('option.chosen puts the option words on the card and clears its why_not', () => {
    const g = fold(
      log(
        card('a', { body: 'old' }),
        ev('node.added', { id: 'a:opt0', kind: 'option', title: 'B', body: 'new', why_not: 'slow' }),
        ev('option.chosen', { card: 'a', option: 'a:opt0' }),
        ev('option.chosen', { card: 'a', option: 'missing' }),
      ),
    )
    expect([g.nodes.get('a')!.title, g.nodes.get('a')!.body]).toEqual(['B', 'new'])
    expect(g.nodes.get('a:opt0')!.why_not).toBeUndefined()
  })

  test('option.chosen keeps the card body when the option has none', () => {
    const g = fold(log(card('a', { body: 'kept' }), ev('node.added', { id: 'o', kind: 'option', title: 'B' }), ev('option.chosen', { card: 'a', option: 'o' })))
    expect(g.nodes.get('a')!.body).toBe('kept')
  })
})

describe('a staged change on a real card', () => {
  const body = 'first block\n\nsecond block'

  test('verifies ops against the body as folded, and applies them on accept', () => {
    const g = fold(
      log(
        card('a', { body }),
        ev('change.proposed', {
          id: 'a',
          title: 'A2',
          why: 'clearer',
          ops: [
            { tag: 'elaborated', old: 'first block', new: 'first, reworded' },
            { tag: 'removed', old: 'second block' },
            { tag: 'new', new: 'third' },
          ],
        }),
        ev('change.accepted', { id: 'a' }),
      ),
    )
    const a = g.nodes.get('a')!
    expect([a.title, a.why, a.body, a.pending]).toEqual(['A2', 'clearer', 'first, reworded\n\nthird', undefined])
  })

  test('a quote that is not in the body is rejected and demoted, never trusted', () => {
    const g = fold(log(card('a', { body }), ev('change.proposed', { id: 'a', ops: [{ tag: 'elaborated', old: 'not there', new: 'x' }] })))
    const p = g.nodes.get('a')!.pending!
    expect(p.ops).toEqual([
      { tag: 'new', new: 'x' },
      { tag: 'removed', old: 'not there' },
    ])
    expect(p.rejected).toHaveLength(1)
  })

  test('a title-only change keeps the body; discard drops the change and keeps the card', () => {
    const g = fold(log(card('a', { body }), ev('change.proposed', { id: 'a', title: 'T' }), ev('change.accepted', { id: 'a' })))
    expect([g.nodes.get('a')!.title, g.nodes.get('a')!.body]).toEqual(['T', body])
    const d = fold(log(card('a', { body }), ev('change.proposed', { id: 'a', title: 'T' }), ev('change.discarded', { id: 'a' })))
    expect([d.nodes.get('a')!.title, d.nodes.get('a')!.pending]).toEqual(['a', undefined])
  })

  test('a change on a missing id, or an accept with nothing pending, does nothing', () => {
    const g = fold(log(card('a'), ev('change.proposed', { id: 'nope', title: 'T' }), ev('change.accepted', { id: 'a' }), ev('change.discarded', { id: 'nope' })))
    expect(g.nodes.get('a')!.title).toBe('a')
  })
})

describe('notes and sources', () => {
  test('a note lands on its node thread, in order, with who said it', () => {
    const events = log(card('a'), ev('note.added', { node: 'a', text: 'one' }), ev('note.added', { node: 'a', text: 'two' }))
    events[2].actor = 'you'
    const notes = fold(events).notes.get('a')!
    expect(notes.map((n) => [n.text, n.from])).toEqual([
      ['one', 'agent'],
      ['two', 'you'],
    ])
  })
})

describe('staleness', () => {
  // c depends on b depends on a.
  const chain = [card('a'), card('b'), card('c'), edge('b', 'a', 'depends_on'), edge('c', 'b', 'depends_on')]

  test('a reopen with no reason reads as invalidated and marks the next hop stale', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a' })))
    expect([...g.stale]).toEqual(['b'])
    expect(g.nodes.get('a')!.status).toBe('open')
    expect(g.reopens.get('a')!.reason).toBe('invalidated')
  })

  test('a card decided again after its reopen no longer reports that reopen', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a' }), ev('status.set', { id: 'a', status: 'decided' })))
    expect(g.nodes.get('a')!.status).toBe('decided')
    expect(g.reopens.has('a')).toBe(false)
  })

  test('the trace names the origin, the hops and the reason', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a', reason: 'rejected', why: 'lost' })))
    const [t] = g.flagWhy.get('b')!
    expect([t.kind, t.origin, t.reason, t.why, t.via]).toEqual(['stale', 'a', 'rejected', 'lost', ['a']])
  })

  test('postponed marks the whole closure postponed, not stale', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a', reason: 'postponed' })))
    expect([...g.postponed].sort()).toEqual(['b', 'c'])
    expect(g.stale.size).toBe(0)
  })

  test('the postponed card itself is a postponement origin, not marked postponed', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a', reason: 'postponed' })))
    expect([...g.postponedOrigins]).toEqual(['a'])
    expect(g.postponed.has('a')).toBe(false)
    expect(toJSON(g).postponedOrigins).toEqual(['a'])
  })

  test("the postponed card itself is a postponed slice of its parent's bar", () => {
    const g = fold(log(ev('node.added', { id: 'p', kind: 'card', title: 'p', status: 'open' }), ev('node.added', { id: 'k', kind: 'card', title: 'k', status: 'proto' }), ev('edge.added', { from: 'k', to: 'p', type: 'refines' }), ev('reopened', { id: 'k', reason: 'postponed' })))
    expect(g.rollup.get('p')).toMatchObject({ cards: 2, postponed: 1, openPostponed: 1 })
  })

  test('a later decision or a later invalidating reopen ends the postponement', () => {
    const decided = fold(log(...chain, ev('reopened', { id: 'a', reason: 'postponed' }), ev('status.set', { id: 'a', status: 'decided' })))
    expect(decided.postponedOrigins.size).toBe(0)
    const invalidated = fold(log(...chain, ev('reopened', { id: 'a', reason: 'postponed' }), ev('reopened', { id: 'a' })))
    expect(invalidated.postponedOrigins.size).toBe(0)
  })

  test('stale wins over postponed on one card, and in its trace', () => {
    const g = fold(log(...chain, card('x'), edge('c', 'x', 'depends_on'), ev('reopened', { id: 'x', reason: 'postponed' }), ev('reopened', { id: 'b' })))
    expect(g.stale.has('c')).toBe(true)
    expect(g.postponed.has('c')).toBe(false)
    expect(g.flagWhy.get('c')!.map((t) => t.kind)).toEqual(['stale'])
  })

  test('a rederive after the reopen clears the card, and can set its status', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a' }), ev('rederived', { id: 'b', status: 'decided' })))
    expect(g.stale.size).toBe(0)
    expect(g.nodes.get('b')!.status).toBe('decided')
  })

  // #vi-prop: a reopen marks its direct children, through refines, as well as its dependents.
  describe('the refines tree', () => {
    const tree = [card('p'), card('k'), card('gk'), edge('k', 'p', 'refines'), edge('gk', 'k', 'refines')]

    test('a reopen marks a direct child stale, and the trace names the parent', () => {
      const g = fold(log(...tree, ev('reopened', { id: 'p' })))
      expect([...g.stale]).toEqual(['k'])
      expect(g.flagWhy.get('k')![0].via).toEqual(['p'])
    })

    test('postponed marks every card below, at any depth', () => {
      const g = fold(log(...tree, ev('reopened', { id: 'p', reason: 'postponed' })))
      expect([...g.postponed].sort()).toEqual(['gk', 'k'])
    })

    test('an option under the card is not marked', () => {
      const g = fold(log(card('p'), ev('node.added', { id: 'p:opt0', kind: 'option', title: 'o' }), edge('p:opt0', 'p', 'refines'), ev('reopened', { id: 'p' })))
      expect(g.stale.size).toBe(0)
    })

    test('a card moved under the parent after the reopen gets no mark', () => {
      const g = fold(log(card('p'), card('k'), ev('reopened', { id: 'p' }), ev('level.moved', { id: 'k', parent: 'p' })))
      expect(g.stale.size).toBe(0)
    })
  })

  // #vi-prop-bornstale: a link newer than a change carries no mark from it.
  test('a card made and linked after the reopen gets no mark', () => {
    const g = fold(log(card('a'), ev('reopened', { id: 'a' }), card('late'), edge('late', 'a', 'depends_on')))
    expect(g.stale.has('late')).toBe(false)
  })

  test('an old card that gains a new link after the reopen gets no mark through it', () => {
    const g = fold(log(...chain, card('x'), ev('reopened', { id: 'b' }), edge('x', 'b', 'depends_on')))
    expect([...g.stale]).toEqual(['c'])
  })

  test('the mark stops at a new link but still flows on through older ones', () => {
    // x links to b after the reopen, and to a before it. The old link still carries the mark.
    const g = fold(log(...chain, card('x'), edge('x', 'a', 'depends_on'), ev('reopened', { id: 'a' }), edge('x', 'b', 'depends_on')))
    expect(g.stale.has('x')).toBe(true)
    expect(g.flagWhy.get('x')![0].via).toEqual(['a'])
  })

  test('a link removed and made again after the reopen counts as new', () => {
    const g = fold(
      log(...chain, ev('reopened', { id: 'a' }), ev('edge.removed', { from: 'b', to: 'a', type: 'depends_on' }), edge('b', 'a', 'depends_on')),
    )
    expect(g.stale.size).toBe(0)
  })

  test('linking an old edge again with a reason does not make it new', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a' }), ev('edge.added', { from: 'b', to: 'a', type: 'depends_on', why: 'w' })))
    expect([...g.stale]).toEqual(['b'])
  })

  test('the rederive order puts a flagged dependency before its dependents', () => {
    const g = fold(log(...chain, ev('reopened', { id: 'a', reason: 'postponed' })))
    expect(g.rederiveOrder).toEqual(['b', 'c'])
  })

  test('a depends_on cycle still lists every flagged card', () => {
    const g = fold(log(card('a'), card('b'), card('c'), edge('b', 'c', 'depends_on'), edge('c', 'b', 'depends_on'), edge('b', 'a', 'depends_on'), ev('reopened', { id: 'a', reason: 'postponed' })))
    expect([...g.rederiveOrder].sort()).toEqual(['b', 'c'])
  })
})

describe('rollup and unchallenged', () => {
  test('counts the subtree by status, postponed slice, yours and unchallenged', () => {
    const g = fold(
      log(
        // Only the stored --unchallenged statement flags a card — #werk-contract-guess. d has
        // the statement and an option, so the option answers it. m is who:me and still flags.
        card('root', { status: 'decided', who: 'you', noAlternative: true }),
        card('o'),
        card('p', { status: 'proto' }),
        card('d', { status: 'decided', who: 'you', noAlternative: true }),
        card('m', { status: 'decided', who: 'me', noAlternative: true }),
        card('y', { status: 'decided', who: 'you' }),
        ev('node.added', { id: 'd:opt0', kind: 'option', title: 'no' }),
        edge('d:opt0', 'd', 'alternative_to'),
        edge('o', 'root'),
        edge('p', 'root'),
        edge('d', 'root'),
        edge('m', 'root'),
        card('dep', { status: 'decided' }),
        edge('o', 'dep', 'depends_on'),
        edge('p', 'dep', 'depends_on'),
        edge('d', 'dep', 'depends_on'),
        card('bad'),
        edge('m', 'bad', 'depends_on'),
        ev('reopened', { id: 'dep', reason: 'postponed' }),
        ev('reopened', { id: 'bad' }),
      ),
    )
    // y is who:you, decided, with no option — but nobody stated it unchallenged.
    expect([...g.unchallenged]).toEqual(['root', 'm'])
    expect(g.rollup.get('root')).toEqual({
      cards: 5,
      open: 1,
      proto: 1,
      decided: 3,
      yours: 2,
      unchallenged: 2,
      stale: 1,
      postponed: 3,
      openPostponed: 1,
      protoPostponed: 1,
      decidedPostponed: 1,
    })
  })

  test('a refines cycle does not hang the walk', () => {
    const g = fold(log(card('a'), card('b'), edge('a', 'b'), edge('b', 'a')))
    expect(g.rollup.get('a')!.cards).toBe(2)
  })
})

describe('toJSON', () => {
  test('turns every Map and Set into plain JSON the browser can read', () => {
    const g = fold(log(card('a'), card('b'), edge('b', 'a', 'depends_on'), ev('reopened', { id: 'a' }), ev('note.added', { node: 'a', text: 'hi' })))
    const j = JSON.parse(JSON.stringify(toJSON(g)))
    expect(j.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b'])
    expect(j.stale).toEqual(['b'])
    expect(j.notes.a[0].text).toBe('hi')
    expect(j.rollup.a.cards).toBe(1)
    expect(j.flagWhy.b[0].origin).toBe('a')
    expect(j.reopens.a.reason).toBe('invalidated')
  })
})

describe('the refines neighbours --reparent reads', () => {
  test('childrenOf lists the direct children only', () => {
    const g = fold(log(card('root'), card('a'), edge('a', 'root'), card('b'), edge('b', 'a')))
    expect(childrenOf(g, 'root')).toEqual(['a'])
  })
  test('parentOf finds a live parent, a held one, or nothing', () => {
    const g = fold(log(card('root'), card('a'), edge('a', 'root'), ghost('g'), edge('g', 'a')))
    expect([parentOf(g, 'a'), parentOf(g, 'g'), parentOf(g, 'root')]).toEqual(['root', 'a', undefined])
  })
})
