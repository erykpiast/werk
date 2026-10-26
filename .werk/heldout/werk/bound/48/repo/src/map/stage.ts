// What an accept and a discard of one ghost take with them (#werk-propose-new, #werk-propose-new-carry).
// Each function returns the ids in the order their events must be written.
import { ancestorsOf, descendantsOf, linksFrom, linksTo } from "./tree.ts";
import type { FoldedMap } from "./types.ts";

const isGhost = (map: FoldedMap, id: string) => map.nodes.get(id)?.proposed === true;

/** The ghost options of a card, and the ghost sources and excerpts it is supported_by. */
function companions(map: FoldedMap, card: string): string[] {
  const options = linksTo(map, card, "alternative_to").map((link) => link.from);
  const evidence = linksFrom(map, card, "supported_by").map((link) => link.to);
  return [...options, ...evidence].filter((id) => isGhost(map, id));
}

/**
 * An accept of `id`: its ghost refines ancestors up to the first real one, top first, then `id`,
 * then the ghost options and evidence of each of those cards. A click cannot orphan a card or
 * leave it without its proof.
 */
export function acceptSet(map: FoldedMap, id: string): string[] {
  const chain: string[] = [];
  for (const above of ancestorsOf(map, id)) {
    if (!isGhost(map, above)) break;
    chain.unshift(above);
  }
  chain.push(id);
  const out = [...chain];
  for (const card of chain) for (const each of companions(map, card)) if (!out.includes(each)) out.push(each);
  return out;
}

/**
 * A discard of `id`: `id` and its ghost descendants, deepest first, with the ghost options and the
 * ghost excerpts of each; then each ghost source of theirs that no remaining node cites.
 */
export function discardSet(map: FoldedMap, id: string): string[] {
  const cards = [id, ...descendantsOf(map, id).filter((each) => isGhost(map, each))].reverse();
  const out: string[] = [];
  const sources: string[] = [];
  for (const card of cards) {
    for (const each of companions(map, card)) {
      if (out.includes(each) || sources.includes(each)) continue;
      if (map.nodes.get(each)?.kind === "source") sources.push(each);
      else out.push(each);
    }
    out.push(card);
  }
  for (const source of sources) {
    const citers = linksTo(map, source, "supported_by").map((link) => link.from);
    if (citers.every((citer) => out.includes(citer))) out.push(source);
  }
  return out;
}
