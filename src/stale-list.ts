/**
 * #werk-cli-stale: every marked card, in the order to fix them, with the reason for each mark.
 * Pure: a function of the fold. The Flow tab reads the same marks (#vi-flowtab-list), so the
 * two never disagree.
 *
 * Three kinds of mark:
 * - stale: a change reached the card along a link (#vi-prop).
 * - paused: a postponement reached it. The content still holds (#pr-wf-paused-basis).
 * - waiting: an undecided card whose basis is open or stale (#map-wait). Derived here,
 *   never written. A paused basis holds, so it makes nothing wait.
 */
import type { FlagTrace, Graph } from './types.ts'

export type MarkKind = 'stale' | 'paused' | 'waiting'
export const MARK_KINDS: MarkKind[] = ['stale', 'paused', 'waiting']

export type Mark = {
  kind: MarkKind
  id: string
  title: string
  /** For stale and paused: where each mark came from. */
  traces: FlagTrace[]
  /** For waiting: each basis the card waits for, and why it does not hold yet. */
  waitsFor: { id: string; title: string; state: 'open' | 'proto' | 'stale' }[]
}

/** The card and every card under it along refines links. */
export function subtreeOf(g: Graph, id: string): Set<string> {
  const out = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const parent = queue.shift()!
    for (const e of g.edges) {
      if (e.type === 'refines' && e.to === parent && !out.has(e.from)) {
        out.add(e.from)
        queue.push(e.from)
      }
    }
  }
  return out
}

/** Each live card that waits on its basis, with the basis it waits for. */
export function waitingCards(g: Graph): Map<string, Mark['waitsFor']> {
  const out = new Map<string, Mark['waitsFor']>()
  for (const n of g.nodes.values()) {
    if (n.kind !== 'card' || n.proposed || n.status === 'decided') continue
    if (g.stale.has(n.id) || g.postponed.has(n.id)) continue
    const waits: Mark['waitsFor'] = []
    for (const e of g.edges) {
      if (e.from !== n.id || e.type !== 'depends_on') continue
      const basis = g.nodes.get(e.to)
      if (!basis) continue
      const state = g.stale.has(basis.id) ? 'stale' : basis.status === 'decided' ? null : (basis.status ?? 'open')
      if (state) waits.push({ id: basis.id, title: basis.title, state })
    }
    if (waits.length) out.set(n.id, waits)
  }
  return out
}

/**
 * The marks, in fix order: a card prints after the cards it depends on. With `under`, only
 * that card and its refines subtree. With `kind`, only that kind.
 */
export function markList(g: Graph, opts: { under?: string; kind?: MarkKind } = {}): Mark[] {
  const scope = opts.under ? subtreeOf(g, opts.under) : null
  const waiting = waitingCards(g)
  // Stale and paused already come in fix order. A waiting card waits on an open or stale
  // card, so it goes after them, and after any waiting card it depends on.
  const order = [...g.rederiveOrder]
  const placed = new Set(order)
  const visit = (id: string, path: Set<string>) => {
    if (placed.has(id) || path.has(id)) return
    path.add(id)
    for (const b of waiting.get(id) ?? []) if (waiting.has(b.id)) visit(b.id, path)
    placed.add(id)
    order.push(id)
  }
  for (const id of [...waiting.keys()].sort()) visit(id, new Set())

  const out: Mark[] = []
  for (const id of order) {
    if (scope && !scope.has(id)) continue
    const kind: MarkKind = g.stale.has(id) ? 'stale' : g.postponed.has(id) ? 'paused' : 'waiting'
    if (opts.kind && opts.kind !== kind) continue
    out.push({
      kind,
      id,
      title: g.nodes.get(id)?.title ?? '',
      traces: kind === 'waiting' ? [] : (g.flagWhy.get(id) ?? []).filter((t) => (t.kind === 'stale') === (kind === 'stale')),
      waitsFor: waiting.get(id) ?? [],
    })
  }
  return out
}

/** The printed form: one line per card, then one line per reason under it. */
export function renderMarks(marks: Mark[]): string[] {
  if (marks.length === 0) return ['Nothing is marked.']
  const lines: string[] = []
  for (const m of marks) {
    lines.push(`${m.kind.toUpperCase().padEnd(7)}  ${m.id}  ${m.title}`)
    for (const t of m.traces) {
      const why = t.why ? ` — ${t.why}` : ''
      lines.push(`         from #${t.origin}, ${t.reason} on ${t.at.slice(0, 10)}${why}`)
    }
    if (m.kind !== 'waiting' && m.traces.length === 0) lines.push('         from a change with no trace on record')
    for (const b of m.waitsFor) lines.push(`         waits for #${b.id} (${b.state})  ${b.title}`)
  }
  return lines
}
