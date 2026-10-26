/**
 * The watch from the decided cards back to the open tickets that cite them. See
 * #st-ticket-watch.
 *
 * A plan records a print of each card a ticket cites. On each change to the decision log,
 * ticketWatch() compares those prints with the cards as they are now, and returns the board
 * events that hold a changed ticket in blocked. It is a plain function of the graph and the
 * board, so the same log always gives the same marks.
 */
import { createHash } from 'node:crypto'
import { CITED_CHANGED } from './board.ts'
import type { Board, BoardEventMap, Ticket } from './board.ts'
import { planScope } from './plan-tickets.ts'
import type { Graph, GraphNode } from './types.ts'

/** What a ticket's build depends on in one card. A comment or a view change is not in it. */
export type CardPrint = {
  /** A hash of the title, the why and the body. */
  text: string
  status: string
  /** A stale or a postponed mark. */
  marked?: true
  /** depends_on targets, sorted. */
  deps: string[]
  removed?: true
}

/** A hash of a card's title, why and body: its wording, as a version. */
export function textPrint(n: Pick<GraphNode, 'title' | 'why' | 'body'>): string {
  return createHash('sha1')
    .update([n.title, n.why ?? '', n.body ?? ''].join('\0'))
    .digest('hex')
    .slice(0, 12)
}

/** `held`: count the edges a ghost holds until it is accepted. A proposal's print takes them,
 *  so accepting the proposal is not a change to it (#st-build-missing-decision). */
export function cardPrint(g: Graph, id: string, o: { held?: boolean } = {}): CardPrint {
  const n = g.nodes.get(id)
  if (!n) return { text: '', status: '', deps: [], removed: true }
  const text = textPrint(n)
  const deps = [...g.edges, ...(o.held ? g.ghostEdges : [])]
    .filter((e) => e.type === 'depends_on' && e.from === id)
    .map((e) => e.to)
    .sort()
  return {
    text,
    status: n.status ?? 'decided',
    ...(g.stale.has(id) || g.postponed.has(id) ? { marked: true as const } : {}),
    deps,
  }
}

/** The prints a plan records for the cards one ticket cites. A cite of no card is skipped. */
export function citePrints(g: Graph, cites: string[], o: { held?: boolean } = {}): Record<string, CardPrint> {
  return Object.fromEntries(cites.filter((id) => g.nodes.has(id)).map((id) => [id, cardPrint(g, id, o)]))
}

/** Each kind of change between two prints of one card, in words. Empty when nothing counts. */
export function printChanges(was: CardPrint, now: CardPrint): string[] {
  if (now.removed) return was.removed ? [] : ['removed']
  if (was.removed) return ['restored']
  const out: string[] = []
  if (was.text !== now.text) out.push('reworded')
  if (was.status !== now.status) out.push(`${was.status} → ${now.status}`)
  if (!was.marked && now.marked) out.push('marked stale')
  if (was.marked && !now.marked) out.push('stale mark cleared')
  const added = now.deps.filter((d) => !was.deps.includes(d))
  const dropped = was.deps.filter((d) => !now.deps.includes(d))
  if (added.length) out.push(`depends_on added: ${added.map((d) => `#${d}`).join(', ')}`)
  if (dropped.length) out.push(`depends_on removed: ${dropped.map((d) => `#${d}`).join(', ')}`)
  return out
}

const isOpen = (t: Ticket) => !t.archived && (t.column === 'ready' || t.column === 'blocked')

export type WatchEvent =
  | { type: 'ticket.moved'; payload: BoardEventMap['ticket.moved'] }
  | { type: 'run.cited'; payload: BoardEventMap['run.cited'] }
  /** A merged ticket was built on a proposal that changed or went: it needs a follow-up. The
   *  caller files it and records `ticket.decision-changed` (#st-build-missing-decision). */
  | { type: 'decision.changed'; payload: { id: string; reason: string; changes: string[] } }

/** Each counted change between the recorded prints and the cards now, as "#id what". */
function changesOf(g: Graph, prints: Record<string, CardPrint>, o: { held?: boolean } = {}): string[] {
  return Object.entries(prints)
    .map(([id, was]) => ({ id, kinds: printChanges(was, cardPrint(g, id, o)) }))
    .filter((c) => c.kinds.length > 0)
    .map((c) => `#${c.id} ${c.kinds.join(', ')}`)
}

/**
 * The board events the current map calls for. An open ticket with a changed cited card goes
 * to blocked, and its reason names each change. A plan with open tickets gets the
 * cards-cited result over its current scope, so a new card that no ticket cites is reported
 * (#st-ticket-set-checks). Nothing is returned when the board already says the same thing.
 */
export function ticketWatch(g: Graph, board: Board): WatchEvent[] {
  const out: WatchEvent[] = []
  for (const t of board.tickets.values()) {
    // #st-build-missing-decision: a merged ticket answers to the proposals it was built on.
    if (t.proposals && !t.archived && t.column === 'done') {
      const changes = changesOf(g, t.proposals, { held: true })
      const reason = `a decision it was built on changed: ${changes.join('; ')}`
      if (changes.length && t.decisionChanged !== reason) out.push({ type: 'decision.changed', payload: { id: t.id, reason, changes } })
    }
    if (!(t.cites || t.proposals) || !isOpen(t)) continue
    const changes = [...changesOf(g, t.cites ?? {}), ...changesOf(g, t.proposals ?? {}, { held: true })]
    if (changes.length === 0) continue
    const reason = `a cited card changed since the plan: ${changes.join('; ')}`
    if (t.heldBy === CITED_CHANGED && t.reason === reason) continue
    out.push({ type: 'ticket.moved', payload: { id: t.id, to: 'blocked', reason, check: CITED_CHANGED } })
  }

  const byRun = new Map<string, Ticket[]>()
  for (const t of board.tickets.values()) {
    if (t.archived || !t.cites) continue
    const list = byRun.get(t.run) ?? []
    list.push(t)
    byRun.set(t.run, list)
  }
  for (const [run, tickets] of byRun) {
    if (!tickets.some(isOpen) || !g.nodes.has(run)) continue
    const cited = new Set(tickets.flatMap((t) => Object.keys(t.cites!)))
    const missing = planScope(g, run)
      .cards.filter((n) => (n.status ?? 'decided') === 'decided' && !cited.has(n.id))
      .map((n) => n.id)
    const ok = missing.length === 0
    const detail = ok ? 'every decided card is cited' : `not cited: ${missing.join(', ')}`
    const last = board.runs.get(run)?.cited
    if (last ? last.ok === ok && last.detail === detail : ok) continue
    out.push({ type: 'run.cited', payload: { run, ok, detail } })
  }
  return out
}
