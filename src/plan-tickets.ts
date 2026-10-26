/**
 * The pure half of the planner: what the spec and ticket writers are shown. Split from
 * plan.ts so the 90% line gate can hold it without holding the child process — see
 * #werk-test-scope-src0-pure-scope. Reading tickets back and checking them is src/ticket.ts.
 */
import type { Graph, GraphNode } from './types.ts'

/** BFS over the refines tree, `rootId` included. Cards only — mirrors `werk find`'s walk. */
export function subtreeCards(g: Graph, rootId: string): GraphNode[] {
  const children = new Map<string, string[]>()
  for (const e of g.edges) {
    if (e.type !== 'refines') continue
    const list = children.get(e.to) ?? []
    list.push(e.from)
    children.set(e.to, list)
  }
  const out: GraphNode[] = []
  const queue = [rootId]
  const seen = new Set([rootId])
  while (queue.length > 0) {
    const current = queue.shift()!
    const n = g.nodes.get(current)
    if (n?.kind === 'card') out.push(n)
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }
  return out
}

/**
 * The cards a plan of `subtreeId` covers, in two tiers (#st-spec-linked). The first tier,
 * `cards`, is the subtree and the cards it links, one hop out: it is gated and must be cited.
 * The second tier, `context`, is every other decided card the first tier rests on — see
 * `scopeClosure`. A stale or postponed card is not a decision in force, so it is out of both
 * tiers, the same as the builder's closure leaves it out (#st-ticket-set-checks).
 */
export function planScope(
  g: Graph,
  subtreeId: string,
): { tree: GraphNode[]; linked: GraphNode[]; cards: GraphNode[]; context: GraphNode[] } {
  const inForce = (n: { id: string }) => !g.stale.has(n.id) && !g.postponed.has(n.id) && !g.postponedOrigins.has(n.id)
  const tree = subtreeCards(g, subtreeId).filter(inForce)
  const linked = linkedCards(g, tree).filter(inForce)
  const cards = [...tree, ...linked]
  return { tree, linked, cards, context: scopeClosure(g, cards) }
}

/**
 * Every decided card that `start` rests on, outside `start`, in first-reached order. Each card
 * in the scope adds its refines children and its depends_on targets, until nothing new comes
 * in, so a target arrives with its whole subtree. The walk never goes from a card to its
 * parent. It stops at a card that is open, proto, stale or postponed, and does not go below it
 * (#st-spec-linked).
 */
export function scopeClosure(g: Graph, start: GraphNode[]): GraphNode[] {
  const next = new Map<string, string[]>()
  const add = (from: string, to: string) => next.set(from, [...(next.get(from) ?? []), to])
  for (const e of g.edges) {
    if (e.type === 'refines') add(e.to, e.from)
    else if (e.type === 'depends_on') add(e.from, e.to)
  }
  const inForce = (n: GraphNode) =>
    n.kind === 'card' &&
    !n.proposed &&
    (n.status ?? 'decided') === 'decided' &&
    !g.stale.has(n.id) &&
    !g.postponed.has(n.id) &&
    !g.postponedOrigins.has(n.id)
  const inScope = new Set(start.map((n) => n.id))
  const queue = start.filter(inForce).map((n) => n.id)
  const walked = new Set<string>()
  const out: GraphNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    if (walked.has(id)) continue
    walked.add(id)
    for (const to of next.get(id) ?? []) {
      const n = g.nodes.get(to)
      if (!n || !inForce(n)) continue
      if (!inScope.has(to)) {
        inScope.add(to)
        out.push(n)
      }
      queue.push(to)
    }
  }
  return out
}

/** The open and proto cards in the plan's scope. Any one of them stops a plan before an agent
 *  call, and greys the map's Build button (#st-spec-linked, #werk-board-build-subtree). */
export function planBlockers(g: Graph, subtreeId: string): string[] {
  return planScope(g, subtreeId)
    .cards.filter((n) => n.status === 'open' || n.status === 'proto')
    .map((n) => n.id)
}

export function rejectedOptionsFor(g: Graph, cardId: string): GraphNode[] {
  return g.edges
    .filter((e) => e.type === 'alternative_to' && e.to === cardId)
    .map((e) => g.nodes.get(e.from))
    .filter((n): n is GraphNode => !!n)
}

export function sourcesFor(g: Graph, cardId: string): GraphNode[] {
  return g.edges
    .filter((e) => e.type === 'supported_by' && e.from === cardId)
    .map((e) => g.nodes.get(e.to))
    .filter((n): n is GraphNode => !!n)
}

/** A `#card-id` reference in a card's text. An id starts with a letter; an option id has a colon. */
const CARD_REF = /(?:^|[^\w&/#:-])#([a-z][\w-]*(?::[\w-]+)?)/gi

/**
 * The cards the subtree links to, one hop out: every depends_on target and every `#card-id`
 * written in a title, why, or body. Cards only, in first-seen order, none from the subtree
 * itself. The planner reads these in full beside the subtree — see #st-spec-linked.
 */
export function linkedCards(g: Graph, subtree: GraphNode[]): GraphNode[] {
  const inside = new Set(subtree.map((n) => n.id))
  const seen = new Set<string>()
  const out: GraphNode[] = []
  const add = (id: string) => {
    if (inside.has(id) || seen.has(id)) return
    seen.add(id)
    const n = g.nodes.get(id)
    if (n?.kind === 'card' && !n.proposed) out.push(n)
  }
  for (const n of subtree) {
    for (const e of g.edges) if (e.type === 'depends_on' && e.from === n.id) add(e.to)
    for (const text of [n.title, n.why, n.body]) {
      for (const m of (text ?? '').matchAll(CARD_REF)) add(m[1])
    }
  }
  return out
}


export function renderCard(g: Graph, n: GraphNode): string {
  const lines = [`### ${n.id} — ${n.title}`, `status: ${n.status ?? 'decided'}`]
  if (n.why) lines.push(`why: ${n.why}`)
  if (n.body) lines.push('', n.body)
  const rejected = rejectedOptionsFor(g, n.id)
  if (rejected.length) {
    lines.push('', 'Rejected options:')
    for (const r of rejected) lines.push(`- ${r.title}${r.why_not ? ` — ${r.why_not}` : ''}`)
  }
  const sources = sourcesFor(g, n.id)
  if (sources.length) {
    lines.push('', 'Sources:')
    for (const s of sources) lines.push(`- ${s.title}${s.url ? ` (${s.url})` : ''}${s.finding ? `: ${s.finding}` : ''}`)
  }
  return lines.join('\n')
}

/** Every card id and title in the graph — the reference index the planner consults instead
 *  of being handed the whole map as text. */
export function mapIndex(g: Graph): string {
  return [...g.nodes.values()]
    .filter((n) => n.kind === 'card' && !n.proposed)
    .map((n) => `${n.id}: ${n.title}`)
    .join('\n')
}
