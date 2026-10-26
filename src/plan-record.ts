/**
 * What a plan records about itself, beside the board. Pure: plan.ts writes the events and the
 * files. Two records, for comparing two plans of one subtree:
 *
 * - The scope it read (#ms-store-scope). Each card's id, its tier, and the position in the
 *   decision log of the last change to what the planner was shown of it. The decision log is
 *   append-only, so a fold up to that position gives the text again.
 * - The copy of what it wrote (#ms-store-plancopy). Which of the spec and the open tickets it
 *   changed, which it kept as they were, and which it archived. Only what changed is copied.
 */
import type { Event, Graph, GraphNode } from './types.ts'

export type ScopeEntry = { id: string; tier: 1 | 2; seq: number }
/** `chars` is the length of the scope text in the prompt. The tokens are in the step's cost. */
export type ScopeSize = { tier1: number; tier2: number; chars: number }

/** Events that change nothing a planner is shown of a card. */
const UNSHOWN = new Set(['note.added', 'kill.added', 'kill.cleared', 'kill.state', 'obligation.created'])

/**
 * The last decision-log position of each card in the scope. A card's text, as the planner reads
 * it, is its own fields, its rejected options and its sources, so a change to any of them, or to
 * the edge that attaches one, moves the card's position.
 */
export function scopeEntries(g: Graph, events: Event[], first: GraphNode[], second: GraphNode[]): ScopeEntry[] {
  const last = new Map<string, number>()
  const touch = (id: unknown, seq: number) => typeof id === 'string' && last.set(id, Math.max(last.get(id) ?? 0, seq))
  for (const e of events) {
    if (UNSHOWN.has(e.type)) continue
    const p = e.payload ?? {}
    touch(p.id, e.seq)
    // An edge event names both ends. Credit the card whose text the edge changes.
    if (p.type === 'alternative_to') touch(p.to, e.seq)
    if (p.type === 'supported_by') touch(p.from, e.seq)
  }
  const attached = new Map<string, string[]>()
  const attach = (card: string, other: string) => attached.set(card, [...(attached.get(card) ?? []), other])
  for (const e of g.edges) {
    if (e.type === 'alternative_to') attach(e.to, e.from)
    if (e.type === 'supported_by') attach(e.from, e.to)
  }
  const seqOf = (id: string) => Math.max(last.get(id) ?? 0, ...(attached.get(id) ?? []).map((o) => last.get(o) ?? 0))
  return [
    ...first.map((n) => ({ id: n.id, tier: 1 as const, seq: seqOf(n.id) })),
    ...second.map((n) => ({ id: n.id, tier: 2 as const, seq: seqOf(n.id) })),
  ]
}

export type CopyState = 'new' | 'changed' | 'kept' | 'archived'
/** The manifest of one plan's copy. A ticket that started to build is not the plan's, so it is
 *  not listed. */
export type PlanCopy = { spec: Exclude<CopyState, 'archived'> | 'none'; tickets: Record<string, CopyState> }

/**
 * What a plan changed. `before` is what the writers were given: the spec, and the text of each
 * open ticket by number. `known` is every number an earlier plan used, open or not. `after` is
 * every ticket file once the writers are done.
 */
export function planCopy(
  before: { spec: string; open: Map<number, string>; known: Set<number> },
  after: { spec: string; tickets: Map<number, string> },
  archived: Set<number>,
): PlanCopy {
  const spec = !after.spec ? 'none' : !before.spec ? 'new' : before.spec === after.spec ? 'kept' : 'changed'
  const tickets: Record<string, CopyState> = {}
  const nums = new Set([...before.open.keys(), ...[...after.tickets.keys()].filter((n) => !before.known.has(n))])
  for (const num of [...nums].sort((a, b) => a - b)) {
    const key = String(num).padStart(2, '0')
    const text = after.tickets.get(num)
    if (archived.has(num) || (before.open.has(num) && text === undefined)) tickets[key] = 'archived'
    else if (!before.open.has(num)) tickets[key] = 'new'
    else tickets[key] = before.open.get(num) === text ? 'kept' : 'changed'
  }
  return { spec, tickets }
}
