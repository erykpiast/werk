/**
 * What one click of ✓ or one `werk remove` actually touches.
 *
 * Both the CLI and the map's buttons run these, so a click and a typed command commit the
 * same set of events. See #werk-propose-new and #werk-remove.
 */
import type { Graph } from './types.ts'

/** Every edge the map draws for this node, live or held. */
function edgesOf(g: Graph, id: string) {
  return [...g.edges, ...g.ghostEdges].filter((e) => e.from === id || e.to === id)
}

/**
 * The ghosts that go real with this one.
 *
 * Two kinds ride along. A pending `refines` ancestor, because accepting a child under a
 * parent that does not exist yet would orphan it. And a pending `option`, `source` or
 * `excerpt` hanging off the closure, because those are parts of a card, not cards: an
 * option with no card to be an alternative to is not a thing you can read.
 *
 * A pending `depends_on` target is NOT included. That is another card, with its own words,
 * and accepting it as a side effect is exactly the silent append this gate exists to stop.
 */
export function acceptClosure(g: Graph, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const take = (nodeId: string) => {
    if (seen.has(nodeId) || !g.proposed.has(nodeId)) return
    seen.add(nodeId)
    out.push(nodeId)
  }

  // Ancestors first, so the list reads top-down — the order a person would accept by hand.
  const chain: string[] = []
  let parent = g.ghostEdges.find((e) => e.from === id && e.type === 'refines')?.to
  const walked = new Set<string>([id])
  while (parent && g.proposed.has(parent) && !walked.has(parent)) {
    walked.add(parent)
    chain.unshift(parent)
    parent = [...g.edges, ...g.ghostEdges].find((e) => e.from === parent && e.type === 'refines')?.to
  }
  for (const a of chain) take(a)
  take(id)

  // Attachments, including an attachment of an ancestor just taken. One pass over the
  // closure as it grows, so an option on a ghost parent comes along too. An option points
  // at its card; a card points at its evidence. A card that cites a source never rides
  // along with the source: that is another card. #werk-propose-new-carry.
  for (let i = 0; i < out.length; i++) {
    const target = out[i]
    if (g.nodes.get(target)?.kind !== 'card') continue
    for (const e of g.ghostEdges) {
      const other = e.type === 'alternative_to' && e.to === target ? e.from : e.type === 'supported_by' && e.from === target ? e.to : undefined
      if (other && g.nodes.get(other)?.kind !== 'card') take(other)
    }
  }
  return out
}

/**
 * The ghosts that die with this one: its pending `refines` descendants, the pending options
 * on any of them, and the pending evidence no remaining card cites. Leaving a ghost child
 * behind would hang it under a parent that no longer exists, where nothing in the map can
 * reach it. A source another card cites is still doing work for that card, so it stays —
 * the same rule a removal follows. #werk-propose-new-carry.
 */
export function discardClosure(g: Graph, id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) {
    const current = out[i]
    if (g.nodes.get(current)?.kind !== 'card') continue
    for (const e of g.ghostEdges) {
      if (e.to !== current || out.includes(e.from) || !g.proposed.has(e.from)) continue
      if (e.type === 'refines' || e.type === 'alternative_to') out.push(e.from)
    }
  }

  const all = [...g.edges, ...g.ghostEdges]
  const cited = new Set(g.ghostEdges.filter((e) => e.type === 'supported_by' && out.includes(e.from)).map((e) => e.to))
  for (const evidence of cited) {
    if (out.includes(evidence) || !g.proposed.has(evidence) || g.nodes.get(evidence)?.kind === 'card') continue
    const citers = all.filter((e) => e.type === 'supported_by' && e.to === evidence).map((e) => e.from)
    if (citers.every((c) => out.includes(c))) out.push(evidence)
  }
  return out
}

/**
 * What `werk remove <id>` takes out: the card and its live `refines` subtree.
 *
 * A child left behind would have no parent to reach it from, so the tree would still show
 * the mess, one level up. `--reparent` is the escape hatch, and it moves the children
 * before this runs, so they are no longer in the subtree.
 */
export function removalSet(g: Graph, id: string, subtree = true): string[] {
  const out = [id]
  if (subtree) {
    for (let i = 0; i < out.length; i++) {
      const current = out[i]
      for (const e of g.edges) {
        if (e.type === 'refines' && e.to === current && !out.includes(e.from)) out.push(e.from)
      }
    }
  }

  // An option or an excerpt hangs off one card and sits nowhere in the refines tree. Left
  // behind, it is an orphan no view can reach and no cleanup can find. A source cited by a
  // card that survives stays: the evidence is still doing work for that card.
  const attached = (nodeId: string, targets: string[]) =>
    targets.length > 0 && targets.every((t) => out.includes(t)) && g.nodes.get(nodeId)?.kind !== 'card'
  for (const n of g.nodes.values()) {
    if (n.kind === 'card' || out.includes(n.id)) continue
    const cards = g.edges
      .filter((e) => (e.from === n.id && e.type === 'alternative_to') || (e.to === n.id && e.type === 'supported_by'))
      .map((e) => (e.from === n.id ? e.to : e.from))
    if (attached(n.id, cards)) out.push(n.id)
  }
  return out
}

/**
 * The events one removal appends: the children `--reparent` lifts, then every node that
 * leaves the map. The CLI, the ✕ and the ✓ on a proposed removal all run this.
 */
export function planRemoval(g: Graph, id: string, reparent = false): { moves: { id: string; parent: string }[]; ids: string[] } {
  if (id === 'root') throw new Error('the root card cannot be removed. Every other card hangs off it.')
  if (!reparent) return { moves: [], ids: removalSet(g, id) }
  const up = parentOf(g, id)
  const kids = childrenOf(g, id)
  if (kids.length && !up) {
    throw new Error(`"${id}" has ${kids.length} child card(s) and no parent of its own, so --reparent has nowhere to put them.`)
  }
  return { moves: kids.map((kid) => ({ id: kid, parent: up! })), ids: removalSet(g, id, false) }
}

/** Direct children in the refines tree. `--reparent` moves exactly these. */
export function childrenOf(g: Graph, id: string): string[] {
  return g.edges.filter((e) => e.type === 'refines' && e.to === id).map((e) => e.from)
}

/** The refines parent, live or held. */
export function parentOf(g: Graph, id: string): string | undefined {
  return edgesOf(g, id).find((e) => e.from === id && e.type === 'refines')?.to
}

/** Every refines ancestor, nearest first, the root left out. A cycle stops the walk. */
export function ancestorsOf(g: Graph, id: string): string[] {
  const out: string[] = []
  for (let p = parentOf(g, id); p && p !== 'root' && !out.includes(p) && p !== id; p = parentOf(g, p)) out.push(p)
  return out
}
