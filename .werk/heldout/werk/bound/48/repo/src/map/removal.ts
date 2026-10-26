// What a removal takes out of the map (#werk-remove). The fold computes it when it applies the
// removal event, so the one event holds only the card it names (#werk-remove-restore-undo).
import { descendantsOf, linksFrom, linksTo } from "./tree.ts";
import type { FoldedMap, Removal } from "./types.ts";

/** The options of a card, and the sources and excerpts it is supported_by. */
function companions(map: FoldedMap, card: string): string[] {
  const options = linksTo(map, card, "alternative_to").map((link) => link.from);
  const evidence = linksFrom(map, card, "supported_by").map((link) => link.to);
  return [...options, ...evidence];
}

/**
 * The removal of `id`: the card, then its refines subtree unless `reparent` keeps the children in
 * the map, then the options and excerpts of each card that goes, then each source of theirs that no
 * remaining card cites. A branch removed earlier is out already, so it is not in the subtree.
 */
export function removalOf(map: FoldedMap, id: string, reparent: boolean): Removal {
  const cards = reparent ? [id] : [id, ...descendantsOf(map, id)];
  const taken = [...cards];
  const sources: string[] = [];
  for (const card of cards) {
    for (const each of companions(map, card)) {
      if (taken.includes(each) || sources.includes(each)) continue;
      if (map.nodes.get(each)?.kind === "source") sources.push(each);
      else taken.push(each);
    }
  }
  for (const source of sources) {
    const citers = linksTo(map, source, "supported_by").map((link) => link.from);
    if (citers.every((citer) => taken.includes(citer))) taken.push(source);
  }
  if (!reparent) return { taken };
  const children = linksTo(map, id, "refines").map((link) => link.from);
  const parent = linksFrom(map, id, "refines")[0]?.to;
  return children.length === 0 || parent === undefined ? { taken } : { taken, moved: { children, to: parent } };
}

/** The removal that took `id` out, by the id of the card it named. */
export function removalHolding(map: FoldedMap, id: string): string | undefined {
  for (const [named, removal] of map.removals) if (removal.taken.includes(id)) return named;
  return undefined;
}
