import type { Edge } from './types.ts'

/**
 * #vi-prop-nolineage: a depends_on link never points to an ancestor or a descendant. The
 * refines tree already says that a card is part of its parent, so such a link repeats it.
 *
 * Every function here takes the edges as a list, so the held edges of a ghost can be passed
 * in beside the live ones: a ghost sits in the tree through its held refines edge.
 */

type Move = { id: string; parent: string }

function parents(edges: Edge[]): Map<string, string> {
  const up = new Map<string, string>()
  for (const e of edges) if (e.type === 'refines') up.set(e.from, e.to)
  return up
}

/** The refines path from `id` up to `target`, both ends included, or null if `target` is
 *  not an ancestor of `id`. */
function pathUp(up: Map<string, string>, id: string, target: string): string[] | null {
  const path = [id]
  let at = up.get(id)
  while (at !== undefined && !path.includes(at)) {
    path.push(at)
    if (at === target) return path
    at = up.get(at)
  }
  return null
}

/** Why a depends_on link from `from` to `to` is refused, or null if it is allowed. */
export function lineageRefusal(edges: Edge[], from: string, to: string): string | null {
  const up = parents(edges)
  const asc = pathUp(up, from, to)
  if (asc) return `"${to}" is an ancestor of "${from}" (${asc.join(' -> ')}), and refines already says that.`
  const desc = pathUp(up, to, from)
  if (desc) return `"${to}" is a descendant of "${from}" (${desc.join(' -> ')}), and refines already says that.`
  return null
}

/**
 * Why `id` may not take `parent` as its refines parent, or null if it may.
 * #werk-propose-new-real-under-ghost: from every real card the parent links go up through
 * real cards only and never repeat a card. So a real card never sits under a ghost, and a
 * card never sits under itself or under a card below it. `ghost` says which ids are ghosts.
 */
export function parentRefusal(edges: Edge[], ghost: (id: string) => boolean, id: string, parent: string): string | null {
  if (!ghost(id) && ghost(parent)) {
    return `"${id}" is a real card and "${parent}" is only proposed, so "${id}" cannot sit under it. Accept "${parent}" first.`
  }
  if (id === parent) return `"${id}" cannot sit under itself.`
  const below = pathUp(parents(edges), parent, id)
  if (below) return `"${parent}" already sits below "${id}" (${below.join(' -> ')}), so this closes a loop.`
  return null
}

/** The depends_on links that the moves turn into ancestor or descendant links. A move goes
 *  ahead and these links are removed with it. */
export function brokenByMoves(edges: Edge[], moves: Move[]): Edge[] {
  if (moves.length === 0) return []
  const moved = new Set(moves.map((m) => m.id))
  const after = [
    ...edges.filter((e) => !(e.type === 'refines' && moved.has(e.from))),
    ...moves.map((m) => ({ from: m.id, to: m.parent, type: 'refines' as const })),
  ]
  return edges.filter(
    (e) => e.type === 'depends_on' && lineageRefusal(after, e.from, e.to) !== null && lineageRefusal(edges, e.from, e.to) === null,
  )
}
