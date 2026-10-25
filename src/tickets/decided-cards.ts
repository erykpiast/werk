/** The decided cards a ticket may cite: the root and its refines descendants (#werk-ticket-check-verb-form). Pure. */
import type { FoldedMap } from "../map/fold.ts";

function under(map: FoldedMap, id: string, root: string): boolean {
  const seen = new Set<string>();
  for (
    let at: string | undefined = id;
    at !== undefined;
    at = map.parents.get(at)
  ) {
    if (at === root) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}

/** The ids of the decided cards under the root, the root included. A ghost does not count. */
export function decidedUnder(map: FoldedMap, root: string): string[] {
  const ids: string[] = [];
  for (const node of map.nodes.values()) {
    if (node.kind !== "card" || node.status !== "decided" || node.proposed) {
      continue;
    }
    if (under(map, node.id, root)) ids.push(node.id);
  }
  return ids;
}
