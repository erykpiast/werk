/**
 * The map index and the map search (#werk-cli-search). A builder pass reads the index and
 * searches before it decides a question no cited card answers (#st-build-implement-search).
 * Pure: it reads a folded graph and returns lines.
 */
import { subtreeCards } from './plan-tickets.ts'
import type { Graph, GraphNode, Status } from './types.ts'

export type SearchHit = { id: string; status?: Status; title: string; hits: number }

/** Live cards only: a ghost is not in the map yet, and a removed card is not in `nodes`. */
const liveCards = (g: Graph): GraphNode[] => [...g.nodes.values()].filter((n) => n.kind === 'card' && !n.proposed)

/** The id and title of every decided card, in log order. */
export function mapIndex(g: Graph): Array<{ id: string; title: string }> {
  return liveCards(g)
    .filter((n) => n.status === 'decided')
    .map((n) => ({ id: n.id, title: n.title }))
}

/** The words a search reads on one card: its title, why, body, and its options' why-not. */
function wordsOf(g: Graph, n: GraphNode): string {
  const whyNots = g.edges
    .filter((e) => e.type === 'alternative_to' && e.to === n.id)
    .map((e) => g.nodes.get(e.from)?.why_not ?? '')
  return [n.title, n.why ?? '', n.body ?? '', ...whyNots].join('\n').toLowerCase()
}

const count = (text: string, term: string) => text.split(term).length - 1

/** The cards whose words hold every term, case-insensitive, most hits first. With no term,
 *  every card the filters keep. A term is a literal string, not a pattern. */
export function searchMap(g: Graph, terms: string[], opts: { status?: Status; under?: string } = {}): SearchHit[] {
  const lower = terms.map((t) => t.toLowerCase()).filter(Boolean)
  const scope = opts.under ? new Set(subtreeCards(g, opts.under).map((n) => n.id)) : undefined
  const hits: SearchHit[] = []
  for (const n of liveCards(g)) {
    if (opts.status && n.status !== opts.status) continue
    if (scope && !scope.has(n.id)) continue
    const words = wordsOf(g, n)
    const per = lower.map((t) => count(words, t))
    if (per.some((c) => c === 0)) continue
    hits.push({ id: n.id, status: n.status, title: n.title, hits: per.reduce((a, b) => a + b, 0) })
  }
  return hits.sort((a, b) => b.hits - a.hits)
}
