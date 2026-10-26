// Questions about the folded map's links: a card's parent, children, ancestors and evidence.
// Every link counts here, live or held, so a ghost has its place in the tree (#werk-propose-new).
import type { FoldedMap, Link, LinkType } from "./types.ts";

/** The live links, then the held ones. */
export function allLinks(map: FoldedMap): Link[] {
  return [...map.links, ...map.ghostEdges];
}

export function sameLink(a: Omit<Link, "why">, b: Omit<Link, "why">): boolean {
  return a.from === b.from && a.to === b.to && a.type === b.type;
}

export function findLink(map: FoldedMap, link: Omit<Link, "why">): Link | undefined {
  return allLinks(map).find((each) => sameLink(each, link));
}

export function linksFrom(map: FoldedMap, id: string, type: LinkType): Link[] {
  return allLinks(map).filter((link) => link.from === id && link.type === type);
}

export function linksTo(map: FoldedMap, id: string, type: LinkType): Link[] {
  return allLinks(map).filter((link) => link.to === id && link.type === type);
}

/** The card that `id` refines, if any. A card has one parent at most. */
export function parentOf(map: FoldedMap, id: string): string | undefined {
  return linksFrom(map, id, "refines")[0]?.to;
}

export function childrenOf(map: FoldedMap, id: string): string[] {
  return linksTo(map, id, "refines").map((link) => link.from);
}

/** The parents of `id`, nearest first. The walk stops at a repeat, so it ends on any log. */
export function ancestorsOf(map: FoldedMap, id: string): string[] {
  const seen: string[] = [];
  for (let at = parentOf(map, id); at !== undefined && at !== id && !seen.includes(at); at = parentOf(map, at)) {
    seen.push(at);
  }
  return seen;
}

/** True when `a` sits above `b` in the refines tree. */
export function isAncestor(map: FoldedMap, a: string, b: string): boolean {
  return ancestorsOf(map, b).includes(a);
}

/** Every card below `id`, each one after its parent. */
export function descendantsOf(map: FoldedMap, id: string): string[] {
  const out: string[] = [];
  const queue = childrenOf(map, id);
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (next === id || out.includes(next)) continue;
    out.push(next);
    queue.push(...childrenOf(map, next));
  }
  return out;
}

/** True when both ends of the link are real. A link with a ghost end is held (#werk-propose-new). */
export function isLive(map: FoldedMap, link: Link): boolean {
  return map.nodes.get(link.from)?.proposed === false && map.nodes.get(link.to)?.proposed === false;
}
