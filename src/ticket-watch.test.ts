import { describe, expect, test } from 'bun:test'
import { CITED_CHANGED, foldBoard, type BoardEvent, type BoardEventMap, type BoardEventType } from './board.ts'
import { fold } from './fold.ts'
import { cardPrint, citePrints, printChanges, ticketWatch, type CardPrint } from './ticket-watch.ts'
import type { Event } from './types.ts'

/** A decision log from [type, payload] pairs. */
function mapLog(...events: Array<[string, Record<string, unknown>]>): Event[] {
  return events.map(([type, payload], i) => ({ seq: i + 1, at: `t${i}`, actor: 'agent', type, payload }) as Event)
}

function boardLog(...events: Array<{ [T in BoardEventType]: [T, BoardEventMap[T]] }[BoardEventType]>): BoardEvent[] {
  return events.map(([type, payload], i) => ({ seq: i + 1, at: `b${i}`, actor: 'agent', type, payload }) as BoardEvent)
}

const card = (id: string, extra: Record<string, unknown> = {}): [string, Record<string, unknown>] => [
  'node.added',
  { id, kind: 'card', title: id, why: `why ${id}`, status: 'decided', ...extra },
]
const refines = (from: string, to: string): [string, Record<string, unknown>] => ['edge.added', { from, to, type: 'refines' }]
const dependsOn = (from: string, to: string): [string, Record<string, unknown>] => ['edge.added', { from, to, type: 'depends_on', why: 'w' }]

/** A map with a root, two children, and a planned board whose tickets cite them. */
const base = () => [card('root'), card('a'), refines('a', 'root'), card('b'), refines('b', 'root'), dependsOn('a', 'b')] as Array<[string, Record<string, unknown>]>

const planned = (id: string, blockedBy: string[] = []) =>
  ['ticket.planned', { id, run: 'root', file: `${id}.md`, title: id, blockedBy }] as ['ticket.planned', BoardEventMap['ticket.planned']]
const cites = (id: string, cards: Record<string, CardPrint>) => ['ticket.cites', { id, cards }] as ['ticket.cites', BoardEventMap['ticket.cites']]

/** A board planned against `before`: root/01 cites root and a, root/02 cites b. */
function boardAt(before: Event[], ...more: Array<{ [T in BoardEventType]: [T, BoardEventMap[T]] }[BoardEventType]>) {
  const g = fold(before)
  return foldBoard(boardLog(planned('root/01'), planned('root/02'), cites('root/01', citePrints(g, ['root', 'a'])), cites('root/02', citePrints(g, ['b'])), ...more))
}

describe('cardPrint', () => {
  test('a card with no status prints as decided, and its depends_on targets come sorted', () => {
    const g = fold(mapLog(card('x', { status: undefined }), card('z'), card('y'), dependsOn('x', 'z'), dependsOn('x', 'y'), refines('x', 'y')))
    const p = cardPrint(g, 'x')
    expect(p.status).toBe('decided')
    expect(p.deps).toEqual(['y', 'z'])
    expect(p.marked).toBeUndefined()
    expect(p.removed).toBeUndefined()
  })

  test('the title, the why and the body each change the text hash', () => {
    const at = (extra: Record<string, unknown>) => cardPrint(fold(mapLog(card('x', extra))), 'x').text
    const plain = at({})
    expect(at({ title: 'other' })).not.toBe(plain)
    expect(at({ why: 'other' })).not.toBe(plain)
    expect(at({ body: 'text' })).not.toBe(plain)
    expect(at({})).toBe(plain)
  })

  test('a missing card prints as removed', () => {
    expect(cardPrint(fold(mapLog()), 'gone')).toEqual({ text: '', status: '', deps: [], removed: true })
  })

  test('a stale or a postponed mark prints as marked', () => {
    const stale = fold(mapLog(card('x'), card('y'), dependsOn('x', 'y'), ['reopened', { id: 'y', reason: 'invalidated' }]))
    expect(cardPrint(stale, 'x').marked).toBe(true)
    const paused = fold(mapLog(card('x'), card('y'), dependsOn('x', 'y'), ['reopened', { id: 'y', reason: 'postponed' }]))
    expect(cardPrint(paused, 'x').marked).toBe(true)
  })

  test('a ghost depends_on edge is not in the print', () => {
    const g = fold(mapLog(card('x'), ['node.proposed', { id: 'y', kind: 'card', title: 'y' }], dependsOn('x', 'y')))
    expect(cardPrint(g, 'x').deps).toEqual([])
  })

  test('citePrints skips a cite of no card', () => {
    const g = fold(mapLog(card('x')))
    expect(Object.keys(citePrints(g, ['x', 'nope']))).toEqual(['x'])
  })
})

describe('printChanges', () => {
  const p: CardPrint = { text: 't', status: 'decided', deps: ['a'] }
  const gone: CardPrint = { text: '', status: '', deps: [], removed: true }

  test('no change gives nothing', () => {
    expect(printChanges(p, { ...p })).toEqual([])
    expect(printChanges(gone, gone)).toEqual([])
  })

  test('a removal and a restore', () => {
    expect(printChanges(p, gone)).toEqual(['removed'])
    expect(printChanges(gone, p)).toEqual(['restored'])
  })

  test('each kind of change is named', () => {
    expect(printChanges(p, { ...p, text: 'u' })).toEqual(['reworded'])
    expect(printChanges(p, { ...p, status: 'open' })).toEqual(['decided → open'])
    expect(printChanges(p, { ...p, marked: true })).toEqual(['marked stale'])
    expect(printChanges({ ...p, marked: true }, p)).toEqual(['stale mark cleared'])
    expect(printChanges(p, { ...p, deps: ['b'] })).toEqual(['depends_on added: #b', 'depends_on removed: #a'])
  })
})

describe('ticketWatch: a changed cited card', () => {
  test('a map with no change gives no event', () => {
    const before = mapLog(...base())
    expect(ticketWatch(fold(before), boardAt(before))).toEqual([])
  })

  test('an open ticket that cites a changed card goes to blocked, with every change in the reason', () => {
    const before = mapLog(...base())
    const after = mapLog(...base(), ['node.retitled', { id: 'a', title: 'new' }], ['reopened', { id: 'root', reason: 'invalidated' }], ['node.removed', { id: 'b' }])
    expect(ticketWatch(fold(after), boardAt(before))).toEqual([
      {
        type: 'ticket.moved',
        payload: { id: 'root/01', to: 'blocked', check: CITED_CHANGED, reason: 'a cited card changed since the plan: #root decided → open; #a reworded, marked stale, depends_on removed: #b' },
      },
      { type: 'ticket.moved', payload: { id: 'root/02', to: 'blocked', check: CITED_CHANGED, reason: 'a cited card changed since the plan: #b removed' } },
    ])
  })

  test('a ticket that is building, merging, done or archived is left alone', () => {
    const before = mapLog(...base())
    const after = mapLog(...base(), ['node.retitled', { id: 'a', title: 'new' }], ['node.retitled', { id: 'b', title: 'new' }])
    const b = boardAt(before, ['ticket.moved', { id: 'root/01', to: 'building' }], ['ticket.archived', { id: 'root/02' }])
    expect(ticketWatch(fold(after), b).filter((e) => e.type === 'ticket.moved')).toEqual([])
    for (const col of ['merging', 'done'] as const) {
      const moved = boardAt(before, ['ticket.moved', { id: 'root/01', to: col }], ['ticket.moved', { id: 'root/02', to: col }])
      expect(ticketWatch(fold(after), moved)).toEqual([])
    }
  })

  test('a ticket with no record of its cited cards is not watched', () => {
    const after = mapLog(...base(), ['node.retitled', { id: 'a', title: 'new' }])
    expect(ticketWatch(fold(after), foldBoard(boardLog(planned('root/01'))))).toEqual([])
  })

  test('a ticket already held for the same change gets no second event; a further change updates the reason', () => {
    const before = mapLog(...base())
    const once = mapLog(...base(), ['node.retitled', { id: 'b', title: 'new' }])
    const [first] = ticketWatch(fold(once), boardAt(before))
    expect(first.type).toBe('ticket.moved')
    const held = boardAt(before, [first.type, first.payload] as ['ticket.moved', BoardEventMap['ticket.moved']])
    expect(held.tickets.get('root/02')).toMatchObject({ column: 'blocked', heldBy: CITED_CHANGED })
    expect(ticketWatch(fold(once), held)).toEqual([])

    const twice = mapLog(...base(), ['node.retitled', { id: 'b', title: 'new' }], ['status.set', { id: 'b', status: 'proto' }])
    expect(ticketWatch(fold(twice), held).map((e) => (e.payload as { reason: string }).reason)).toEqual(['a cited card changed since the plan: #b reworded, decided → proto'])
  })
})

describe('ticketWatch: a card no ticket cites', () => {
  test('a new decided card in the subtree fails the cards-cited result of the plan', () => {
    const before = mapLog(...base())
    const after = mapLog(...base(), card('c'), refines('c', 'root'), card('d', { status: 'open' }), refines('d', 'root'))
    expect(ticketWatch(fold(after), boardAt(before))).toEqual([{ type: 'run.cited', payload: { run: 'root', ok: false, detail: 'not cited: c' } }])
  })

  test('the same result is not recorded twice, and a pass after a failure is recorded', () => {
    const before = mapLog(...base())
    const after = mapLog(...base(), card('c'), refines('c', 'root'))
    const failed = boardAt(before, ['run.cited', { run: 'root', ok: false, detail: 'not cited: c' }])
    expect(failed.runs.get('root')!.cited).toEqual({ ok: false, detail: 'not cited: c' })
    expect(ticketWatch(fold(after), failed)).toEqual([])
    expect(ticketWatch(fold(before), failed)).toEqual([{ type: 'run.cited', payload: { run: 'root', ok: true, detail: 'every decided card is cited' } }])
  })

  test('a plan with no open ticket, or whose root is gone, is not checked', () => {
    const before = mapLog(...base())
    const after = mapLog(...base(), card('c'), refines('c', 'root'))
    const built = boardAt(before, ['ticket.moved', { id: 'root/01', to: 'done' }], ['ticket.moved', { id: 'root/02', to: 'done' }])
    expect(ticketWatch(fold(after), built)).toEqual([])
    const noRoot = mapLog(...base(), ['node.removed', { id: 'root' }])
    expect(ticketWatch(fold(noRoot), boardAt(before)).filter((e) => e.type === 'run.cited')).toEqual([])
  })
})

describe('the board record of cited cards', () => {
  test('a new record lifts a hold for a changed cited card, back to the column its blockers give', () => {
    const before = mapLog(...base())
    const hold = (id: string) => ['ticket.moved', { id, to: 'blocked', reason: 'r', check: CITED_CHANGED }] as ['ticket.moved', BoardEventMap['ticket.moved']]
    const b = foldBoard(
      boardLog(planned('root/01'), planned('root/02', ['root/01']), hold('root/01'), hold('root/02'), cites('root/01', {}), cites('root/02', {})),
    )
    expect(b.tickets.get('root/01')).toMatchObject({ column: 'ready', heldBy: undefined, reason: undefined, since: 'b4', cites: {} })
    expect(b.tickets.get('root/02')).toMatchObject({ column: 'blocked', heldBy: undefined, since: 'b1' })
    expect(boardAt(before).tickets.get('root/01')!.cites).toHaveProperty('a')
  })

  test('a hold by another check stays, and a record for no ticket does nothing', () => {
    const b = foldBoard(boardLog(planned('t'), ['ticket.moved', { id: 't', to: 'blocked', reason: 'cycle', check: 'blocked_by' }], cites('t', {}), cites('nope', {})))
    expect(b.tickets.get('t')).toMatchObject({ column: 'blocked', heldBy: 'blocked_by', reason: 'cycle' })
    expect(b.tickets.has('nope')).toBe(false)
  })
})

describe('ticketWatch: a proposal a ticket was built on (#st-build-missing-decision)', () => {
  /** A builder's ghost proposal, decided, with a held depends_on edge to b. */
  const ghost = () =>
    [...base(), ['node.proposed', { id: 'p', kind: 'card', title: 'P', why: 'why p', status: 'decided' }], dependsOn('p', 'b')] as Array<[string, Record<string, unknown>]>
  const proposals = (id: string, g: ReturnType<typeof fold>) =>
    ['ticket.proposals', { id, cards: citePrints(g, ['p'], { held: true }) }] as ['ticket.proposals', BoardEventMap['ticket.proposals']]

  test('an accept is not a change: the held edge counts the same once it goes live', () => {
    const before = mapLog(...ghost())
    const b = boardAt(before, proposals('root/01', fold(before)), ['ticket.moved', { id: 'root/01', to: 'done' }])
    expect(ticketWatch(fold(mapLog(...ghost(), ['change.accepted', { id: 'p' }])), b)).toEqual([])
  })

  test('a discard asks for a follow-up of the merged ticket, once for the same change', () => {
    const before = mapLog(...ghost())
    const after = fold(mapLog(...ghost(), ['change.discarded', { id: 'p' }]))
    const done = boardAt(before, proposals('root/01', fold(before)), ['ticket.moved', { id: 'root/01', to: 'done' }])
    const reason = 'a decision it was built on changed: #p removed'
    expect(ticketWatch(after, done)).toEqual([{ type: 'decision.changed', payload: { id: 'root/01', reason, changes: ['#p removed'] } }])
    const filed = boardAt(before, proposals('root/01', fold(before)), ['ticket.moved', { id: 'root/01', to: 'done' }], ['ticket.decision-changed', { id: 'root/01', reason, followUp: 'root/03' }])
    expect(ticketWatch(after, filed)).toEqual([])
  })

  test('an open ticket whose proposal changed is held like one whose cited card changed', () => {
    const before = mapLog(...ghost())
    const after = fold(mapLog(...ghost(), ['change.discarded', { id: 'p' }]))
    const open = boardAt(before, proposals('root/01', fold(before)))
    expect(ticketWatch(after, open)).toEqual([
      { type: 'ticket.moved', payload: { id: 'root/01', to: 'blocked', check: CITED_CHANGED, reason: 'a cited card changed since the plan: #p removed' } },
    ])
  })
})
