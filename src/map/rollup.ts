/** The rollup of a card: counts over its refines subtree, the card itself included. See #rollup. */
import type { FoldedMap } from "./fold.ts";

export type Rollup = {
  cards: number;
  open: number;
  proto: number;
  decided: number;
  unchallenged: number;
  stale: number;
};

/** The rollup of a real card. A ghost belongs to no rollup, so it has none. */
export function rollup(map: FoldedMap, id: string): Rollup | null {
  const root = map.nodes.get(id);
  if (!root || root.proposed) return null;
  const children = new Map<string, string[]>();
  for (const edge of map.edges) {
    if (edge.type !== "refines") continue;
    children.set(edge.to, [...(children.get(edge.to) ?? []), edge.from]);
  }
  const total: Rollup = {
    cards: 0,
    open: 0,
    proto: 0,
    decided: 0,
    unchallenged: 0,
    stale: 0,
  };
  const seen = new Set<string>();
  const queue = [id];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const node = map.nodes.get(next);
    if (!node || node.proposed) continue;
    total.cards += 1;
    total[node.status] += 1;
    if (node.marks.some((mark) => mark.kind === "stale")) total.stale += 1;
    queue.push(...(children.get(next) ?? []));
  }
  return total;
}

/** The card count first, then each other count that is above zero. */
export function rollupText(r: Rollup): string {
  const parts = [`${r.cards} ${r.cards === 1 ? "card" : "cards"}`];
  for (const key of [
    "open",
    "proto",
    "decided",
    "unchallenged",
    "stale",
  ] as const) {
    if (r[key] > 0) parts.push(`${r[key]} ${key}`);
  }
  return parts.join(", ");
}
