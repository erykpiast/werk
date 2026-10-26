/**
 * One page per card (#vi-onview). The root, a card, a leaf and a source all get the same
 * shape: the detail on top, the sub-cards below. A pure module: the client renders a page
 * from the folded map, and the CLI prints one.
 */
import type { LinkType } from './events.ts'
import { ancestors, type Card, type MapState } from './fold.ts'

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
  const visible = (ids: string[]) => ids.filter((x) => isVisible(state, x)).map((x) => state.cards[x]!)
  if (id === undefined) {
    // A card that refines nothing is top-level. A source that a card is supported_by is
    // that card's evidence, not tree content, so it stays off the root page.
    const placed = new Set(state.links.filter((l) => l.type === 'refines').map((l) => l.from))
    const evidence = new Set(state.links.filter((l) => l.type === 'supported_by').map((l) => l.to))
    const top = Object.keys(state.cards).filter((x) => !placed.has(x) && !evidence.has(x) && state.cards[x]!.kind !== 'option')
    return { card: undefined, trail: [], children: visible(top), dependsOn: [], evidence: [], supports: [], options: [] }
  }
  if (!isVisible(state, id)) return undefined
  const into = (type: LinkType) => state.links.filter((l) => l.to === id && l.type === type).map((l) => l.from)
  const outOf = (type: LinkType) => state.links.filter((l) => l.from === id && l.type === type).map((l) => l.to)
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
