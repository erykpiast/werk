/**
 * One page per card (#vi-onview). The root, a card, a leaf and a source all get the same
 * shape: the detail on top, the sub-cards below. A pure module: the client renders a page
 * from the folded map, and the CLI prints one.
 *
 * A page draws every edge, held ones too, so a ghost sits under its proposed parent and its
 * own edges show on it (#werk-propose-new). The card carries `proposed`, and the view marks it.
 */
import type { LinkType } from './events.ts'
import { allEdges, ancestors, type Card, type MapState } from './fold.ts'
import { MARK_KINDS, marksOf, type Mark, type MarkKind } from './marks.ts'

export type Page = {
  /** The open card. Undefined on the root page, which is the project itself. */
  card: Card | undefined
  /** The refines parents, from the top down to the open card's parent. */
  trail: Card[]
  /** Its refines children: the sub-cards. Options are never sub-cards. */
  children: Card[]
  /** The cards it depends_on. */
  dependsOn: Card[]
  /** Its evidence: the sources it is supported_by. */
  evidence: Card[]
  /** On a source page: the cards it supports. */
  supports: Card[]
  /** The rejected options, each an alternative_to the open card. */
  options: Card[]
}

/** A card is in view when neither it nor a refines parent of it is removed. */
export function isVisible(state: MapState, id: string): boolean {
  const card = state.cards[id]
  if (!card || card.removed) return false
  return ancestors(state, id).every((parent) => !state.cards[parent]!.removed)
}

/** The page of a card, or the root page with no id. Undefined for a card not in view. */
export function pageOf(state: MapState, id?: string): Page | undefined {
  const edges = allEdges(state)
  const visible = (ids: string[]) => ids.filter((x) => isVisible(state, x)).map((x) => state.cards[x]!)
  if (id === undefined) {
    // A card that refines nothing is top-level. A source that a card is supported_by is
    // that card's evidence, not tree content, so it stays off the root page.
    const placed = new Set(edges.filter((l) => l.type === 'refines').map((l) => l.from))
    const evidence = new Set(edges.filter((l) => l.type === 'supported_by').map((l) => l.to))
    const top = Object.keys(state.cards).filter((x) => !placed.has(x) && !evidence.has(x) && state.cards[x]!.kind !== 'option')
    return { card: undefined, trail: [], children: visible(top), dependsOn: [], evidence: [], supports: [], options: [] }
  }
  if (!isVisible(state, id)) return undefined
  const into = (type: LinkType) => edges.filter((l) => l.to === id && l.type === type).map((l) => l.from)
  const outOf = (type: LinkType) => edges.filter((l) => l.from === id && l.type === type).map((l) => l.to)
  return {
    card: state.cards[id]!,
    trail: ancestors(state, id)
      .reverse()
      .map((x) => state.cards[x]!),
    children: visible(into('refines')),
    dependsOn: visible(outOf('depends_on')),
    evidence: visible(outOf('supported_by')),
    supports: visible(into('supported_by')),
    options: visible(into('alternative_to')),
  }
}

/** One line of the staleness listing: a card, the kind of mark, and the trace of each mark. */
export type Marked = { card: Card; kind: MarkKind; marks: Mark[] }

/**
 * The staleness listing: every marked card in view, in the order to fix them. A card comes
 * after the cards it depends_on and after its parent, because it cannot be reviewed while its
 * basis is marked. A stale card is listed as stale only: stale wins over paused. With an id,
 * the listing covers that card and its refines subtree. Undefined for a card not in view.
 */
export function listMarked(state: MapState, options: { id?: string | undefined; only?: MarkKind | undefined } = {}): Marked[] | undefined {
  const { id, only } = options
  if (id !== undefined && !isVisible(state, id)) return undefined
  const inScope = (x: string) => id === undefined || x === id || ancestors(state, x).includes(id)
  const order: string[] = []
  const visited = new Set<string>()
  const visit = (x: string) => {
    if (visited.has(x)) return
    visited.add(x)
    for (const link of state.links) if (link.from === x && (link.type === 'depends_on' || link.type === 'refines')) visit(link.to)
    order.push(x)
  }
  for (const x of Object.keys(state.cards)) visit(x)
  const kinds = only === undefined ? MARK_KINDS : [only]
  return order
    .filter((x) => isVisible(state, x) && inScope(x))
    .flatMap((x) => {
      const card = state.cards[x]!
      return kinds.map((kind) => ({ card, kind, marks: marksOf(card, kind) })).filter((marked) => marked.marks.length > 0)
    })
}
