/**
 * What a removal and a restore do to the map. See #werk-remove, #werk-remove-restore-undo
 * and #werk-write-remove-links.
 * A removed node leaves the map and sits in its removal record. An edge that touches a
 * removed node sits in the waiting list until both of its ends are in the map again.
 */
import type { Edge, FoldedMap, MapNode, Violation } from "./fold.ts";
import { actorRefusal } from "./ghost-rules.ts";

/** Whether a node went out in a removal that is not undone. */
export function isOut(map: FoldedMap, id: string): boolean {
  return map.removals.some((removal) =>
    removal.nodes.some((node) => node.id === id),
  );
}

/** The refusal for a new write that names a node that is out, or null when the node is in. */
export function outRefusal(map: FoldedMap, id: string): Violation | null {
  const removal = map.removals.find((entry) =>
    entry.nodes.some((node) => node.id === id),
  );
  if (!removal) return null;
  return {
    rule: "unknown-card",
    detail:
      removal.id === id
        ? `"${id}" is removed; restore "${id}" first`
        : `"${id}" is removed with "${removal.id}"; restore "${removal.id}" first`,
  };
}

function isLive(edge: Edge, map: FoldedMap): boolean {
  return map.nodes.has(edge.from) && map.nodes.has(edge.to);
}

/** Puts an edge back in the list that its two ends call for, and in the parents of the tree. */
function place(map: FoldedMap, edge: Edge): void {
  if (edge.type === "refines") map.parents.set(edge.from, edge.to);
  const held =
    map.nodes.get(edge.from)?.proposed || map.nodes.get(edge.to)?.proposed;
  (held ? map.ghostEdges : map.edges).push(edge);
}

function checkTarget(
  map: FoldedMap,
  id: string,
  reparent: boolean,
): Violation | null {
  const node = map.nodes.get(id);
  if (!node) {
    return {
      rule: "unknown-card",
      detail: isOut(map, id)
        ? `"${id}" is already out; restore the card that took it`
        : `no card "${id}"`,
    };
  }
  if ((node.kind !== "card" && node.kind !== "option") || node.proposed) {
    return {
      rule: "remove-target",
      detail: `"${id}" is not a card or an option in the map; a ghost is discarded, and evidence goes with its card`,
    };
  }
  if (reparent && !map.parents.has(id)) {
    return {
      rule: "no-grandparent",
      detail: `"${id}" has no parent to take its children`,
    };
  }
  return null;
}

function childrenOf(map: FoldedMap, id: string): string[] {
  return [...map.parents].filter(([, parent]) => parent === id).map(([c]) => c);
}

function subtreeOf(map: FoldedMap, id: string): Set<string> {
  const cards = new Set([id]);
  for (const card of cards) {
    for (const child of childrenOf(map, card)) cards.add(child);
  }
  return cards;
}

/** The options and the excerpts of the cards, and the sources that no card outside cites. */
function evidenceOf(map: FoldedMap, cards: Set<string>): Set<string> {
  const all = [...map.edges, ...map.ghostEdges];
  const taken = new Set(cards);
  for (const edge of all) {
    const from = map.nodes.get(edge.from);
    if (
      edge.type === "alternative_to" &&
      cards.has(edge.to) &&
      from?.kind === "option"
    ) {
      taken.add(edge.from);
    }
  }
  const sources = new Set<string>();
  for (const edge of all) {
    if (edge.type !== "supported_by" || !taken.has(edge.from)) continue;
    const kind = map.nodes.get(edge.to)?.kind;
    if (kind === "excerpt") taken.add(edge.to);
    if (kind === "source") sources.add(edge.to);
  }
  for (const source of sources) {
    const cited = all.some(
      (edge) =>
        edge.type === "supported_by" &&
        edge.to === source &&
        !taken.has(edge.from),
    );
    if (!cited) taken.add(source);
  }
  return taken;
}

/** Stages the removal of a card in the map. The card stays until the removal is accepted. */
export function proposeRemoval(
  map: FoldedMap,
  id: string,
  reparent: boolean,
): Violation | null {
  const refused = checkTarget(map, id, reparent);
  if (refused) return refused;
  (map.nodes.get(id) as MapNode).removal = { reparent };
  return null;
}

/** Takes out the card that has a proposed removal, as it was proposed. Refused unless the person asked for it. */
export function acceptRemoval(
  map: FoldedMap,
  id: string,
  actor: unknown,
): Violation | null {
  const unasked = actorRefusal(actor);
  if (unasked) return unasked;
  const removal = map.nodes.get(id)?.removal;
  if (!removal) {
    return {
      rule: "not-removed",
      detail: `"${id}" has no proposed removal`,
    };
  }
  return removeCard(map, id, removal.reparent);
}

/** Drops the proposed removal and leaves the card in the map. */
export function discardRemoval(map: FoldedMap, id: string): Violation | null {
  const node = map.nodes.get(id);
  if (!node?.removal) {
    return { rule: "not-removed", detail: `"${id}" has no proposed removal` };
  }
  node.removal = null;
  return null;
}

/** Takes the card out with what goes with it. */
export function removeCard(
  map: FoldedMap,
  id: string,
  reparent: boolean,
): Violation | null {
  const refused = checkTarget(map, id, reparent);
  if (refused) return refused;
  const moved: { child: string; parent: string; why: string }[] = [];
  let cards = new Set([id]);
  if (reparent) {
    const parent = map.parents.get(id) as string;
    for (const child of childrenOf(map, id)) {
      for (const list of [map.edges, map.ghostEdges]) {
        const at = list.findIndex(
          (edge) =>
            edge.type === "refines" && edge.from === child && edge.to === id,
        );
        const [edge] = at === -1 ? [] : list.splice(at, 1);
        if (edge) moved.push({ child, parent, why: edge.why });
      }
      map.parents.delete(child);
    }
    for (const { child, why } of moved) {
      place(map, { from: child, to: parent, type: "refines", why });
    }
  } else {
    cards = subtreeOf(map, id);
  }
  const taken = evidenceOf(map, cards);
  const nodes: MapNode[] = [];
  for (const gone of taken) {
    nodes.push(map.nodes.get(gone) as MapNode);
    map.nodes.delete(gone);
    map.parents.delete(gone);
  }
  for (const key of ["edges", "ghostEdges"] as const) {
    const stay: Edge[] = [];
    for (const edge of map[key]) {
      (taken.has(edge.from) || taken.has(edge.to) ? map.waiting : stay).push(
        edge,
      );
    }
    map[key] = stay;
  }
  map.removals.push({ id, reparent, nodes, moved });
  return null;
}

/** Undoes one removal: its nodes return, the moved children go back, and links whose ends are in return. */
export function restoreCard(map: FoldedMap, id: string): Violation | null {
  const removal = map.removals.find((other) => other.id === id);
  if (!removal) {
    const carrier = map.removals.find((other) =>
      other.nodes.some((node) => node.id === id),
    );
    if (carrier) {
      return {
        rule: "not-removed",
        detail: `"${id}" went out with "${carrier.id}"; restore "${carrier.id}"`,
      };
    }
    return map.nodes.has(id)
      ? { rule: "not-removed", detail: `"${id}" is in the map` }
      : { rule: "unknown-card", detail: `no card "${id}"` };
  }
  const parentEdge = map.waiting.find(
    (edge) => edge.type === "refines" && edge.from === id,
  );
  if (parentEdge && !map.nodes.has(parentEdge.to)) {
    return {
      rule: "parent-out",
      detail: `the parent "${parentEdge.to}" of "${id}" is still out; restore it first`,
    };
  }
  for (const node of removal.nodes) map.nodes.set(node.id, node);
  map.removals = map.removals.filter((other) => other !== removal);
  for (const { child, parent, why } of removal.moved) {
    const back: Edge = { from: child, to: id, type: "refines", why };
    const lists = [map.edges, map.ghostEdges, map.waiting];
    for (const list of lists) {
      const at = list.findIndex(
        (edge) =>
          edge.type === "refines" && edge.from === child && edge.to === parent,
      );
      if (at !== -1) list[at] = back;
    }
    if (map.parents.get(child) === parent) map.parents.set(child, id);
  }
  const waiting: Edge[] = [];
  for (const edge of map.waiting) {
    if (isLive(edge, map)) place(map, edge);
    else waiting.push(edge);
  }
  map.waiting = waiting;
  return null;
}
