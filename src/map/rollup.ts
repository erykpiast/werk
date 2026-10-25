/**
 * The rollup of every card over its refines subtree, the card itself included (#rollup).
 * The server holds the one definition. A ghost counts in no rollup, and an option, a source and an
 * excerpt are not cards. The status counts partition the subtree; the flags cut across it (#ro-axes).
 */
import type { FoldedMap, MapNode, Status } from "./fold.ts";

export type Rollup = Record<Status, number> & {
  cards: number;
  /** Decided cards that record that no option was weighed. A flag, not a status. */
  unchallenged: number;
  stale: number;
  /** Cards that carry the postponed word: the postponed card and every card it pauses (#pr-wf-naming). */
  paused: number;
  /** The cards of each status that are postponed, for the hatched slice of the bar (#vi-onview-postponed). */
  pausedBy: Record<Status, number>;
};

export function emptyRollup(): Rollup {
  return {
    cards: 0,
    open: 0,
    proto: 0,
    decided: 0,
    unchallenged: 0,
    stale: 0,
    paused: 0,
    pausedBy: { open: 0, proto: 0, decided: 0 },
  };
}

/** Whether the card shows the postponed word, as its own mark or as a pause from upstream. A stale mark wins (#pr-wf-paused). */
export function isPostponed(node: MapNode): boolean {
  if (node.marks.some((m) => m.kind === "stale")) return false;
  return node.marks.some((m) => m.kind === "paused" || m.kind === "postponed");
}

/** The rollup of every card, ghosts included as zero. */
export function rollups(map: FoldedMap): Record<string, Rollup> {
  const result: Record<string, Rollup> = {};
  for (const node of map.nodes.values()) {
    if (node.kind === "card") result[node.id] = emptyRollup();
  }
  for (const node of map.nodes.values()) {
    if (node.kind !== "card" || node.proposed) continue;
    const stale = node.marks.some((m) => m.kind === "stale");
    const paused = isPostponed(node);
    const unchallenged =
      node.status === "decided" && node.unchallenged !== null;
    for (
      let up: string | undefined = node.id;
      up !== undefined;
      up = map.parents.get(up)
    ) {
      const rollup = result[up];
      if (!rollup) continue;
      rollup.cards += 1;
      rollup[node.status] += 1;
      if (stale) rollup.stale += 1;
      if (unchallenged) rollup.unchallenged += 1;
      if (paused) {
        rollup.paused += 1;
        rollup.pausedBy[node.status] += 1;
      }
    }
  }
  return result;
}
