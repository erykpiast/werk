/**
 * What an accept and a discard do to a ghost and the evidence around it.
 * See #werk-propose-new and #werk-propose-new-carry.
 */
import type { Edge, FoldedMap, Violation } from "./fold.ts";

const EVIDENCE = ["source", "excerpt"];

function isGhost(map: FoldedMap, id: string): boolean {
  return map.nodes.get(id)?.proposed === true;
}

function isGhostOf(map: FoldedMap, id: string, kinds: string[]): boolean {
  const node = map.nodes.get(id);
  return node?.proposed === true && kinds.includes(node.kind);
}

function ghostCheck(map: FoldedMap, id: string): Violation | null {
  if (!map.nodes.has(id)) {
    return { rule: "unknown-card", detail: `no card "${id}"` };
  }
  if (!isGhost(map, id)) {
    return { rule: "not-ghost", detail: `"${id}" is already in the map` };
  }
  return null;
}

/** The refusal for an accept that does not state that the person asked for it. */
export function actorRefusal(actor: unknown): Violation | null {
  return actor === "you"
    ? null
    : {
        rule: "accept-actor",
        detail: "an accept must state that the person asked for it",
      };
}

/**
 * Commits one ghost with its ghost refines ancestors up to the first real card,
 * and the ghost sources, excerpts and options that the committed cards carry.
 * Held edges whose two ends are real go live. Refused unless the person asked for it.
 */
export function acceptGhost(
  map: FoldedMap,
  id: string,
  actor: unknown,
): Violation | null {
  const unasked = actorRefusal(actor);
  if (unasked) return unasked;
  const refused = ghostCheck(map, id);
  if (refused) return refused;
  const accepted = new Set([id]);
  for (
    let parent = map.parents.get(id);
    parent !== undefined && isGhost(map, parent);
    parent = map.parents.get(parent)
  ) {
    accepted.add(parent);
  }
  for (const edge of map.ghostEdges) {
    if (
      edge.type === "supported_by" &&
      accepted.has(edge.from) &&
      isGhostOf(map, edge.to, EVIDENCE)
    ) {
      accepted.add(edge.to);
    }
    if (
      edge.type === "alternative_to" &&
      accepted.has(edge.to) &&
      isGhostOf(map, edge.from, ["option"])
    ) {
      accepted.add(edge.from);
    }
  }
  for (const accept of accepted) {
    const node = map.nodes.get(accept);
    if (node) node.proposed = false;
  }
  const held: Edge[] = [];
  for (const edge of map.ghostEdges) {
    const live = !isGhost(map, edge.from) && !isGhost(map, edge.to);
    (live ? map.edges : held).push(edge);
  }
  map.ghostEdges = held;
  return null;
}

/**
 * Drops a ghost, its ghost descendants, and their ghost options and excerpts.
 * A ghost source goes only when no card that stays cites it.
 */
export function discardGhost(map: FoldedMap, id: string): Violation | null {
  const refused = ghostCheck(map, id);
  if (refused) return refused;
  const dropped = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [child, parent] of map.parents) {
      if (dropped.has(parent) && !dropped.has(child) && isGhost(map, child)) {
        dropped.add(child);
        grew = true;
      }
    }
  }
  const cards = new Set(dropped);
  const sources = new Set<string>();
  for (const edge of map.ghostEdges) {
    if (edge.type === "supported_by" && cards.has(edge.from)) {
      if (isGhostOf(map, edge.to, ["excerpt"])) dropped.add(edge.to);
      if (isGhostOf(map, edge.to, ["source"])) sources.add(edge.to);
    }
    if (
      edge.type === "alternative_to" &&
      cards.has(edge.to) &&
      isGhostOf(map, edge.from, ["option"])
    ) {
      dropped.add(edge.from);
    }
  }
  const touches = (edge: Edge) =>
    dropped.has(edge.from) || dropped.has(edge.to);
  map.ghostEdges = map.ghostEdges.filter((edge) => !touches(edge));
  map.edges = map.edges.filter((edge) => !touches(edge));
  for (const source of sources) {
    const cited = [...map.edges, ...map.ghostEdges].some(
      (edge) => edge.type === "supported_by" && edge.to === source,
    );
    if (!cited) dropped.add(source);
  }
  for (const gone of dropped) {
    map.nodes.delete(gone);
    map.parents.delete(gone);
  }
  return null;
}
