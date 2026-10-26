// The decided cards a ticket set must cite: the root and its refines descendants at any depth
// with status decided. A ghost does not count, also when it is decided (#st-ticket-set-checks).
import { descendantsOf } from "../map/tree.ts";
import type { FoldedMap } from "../map/types.ts";

export function decidedCardsUnder(map: FoldedMap, root: string): string[] {
  return [root, ...descendantsOf(map, root)].filter((id) => {
    const node = map.nodes.get(id);
    return node !== undefined && node.kind === "card" && !node.proposed && node.status === "decided";
  });
}
