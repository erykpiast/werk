/** The counts strip of the header: bare numbers, each with a hover title (#vi-counts, #vi-counts-header). */

export type CountRollup = {
  cards: number;
  open: number;
  proto: number;
  decided: number;
  unchallenged: number;
  stale: number;
  paused: number;
};

export type Count = {
  kind:
    | "total"
    | "open"
    | "proto"
    | "decided"
    | "unchallenged"
    | "stale"
    | "postponed";
  n: number;
  title: string;
};

/**
 * The total, then the dots (open, proto, decided), then the rings (unchallenged, stale, postponed). A zero is left
 * out. A card with no children shows no counts. `scope` is the open card's id, or null for the whole map.
 */
export function countsOf(
  rollup: CountRollup | undefined,
  scope: string | null,
): Count[] {
  if (rollup === undefined || rollup.cards <= 1) return [];
  const counts: Count[] = [
    {
      kind: "total",
      n: rollup.cards,
      title: `${rollup.cards} cards in ${scope === null ? "the whole map" : `#${scope} and everything below it`}`,
    },
    { kind: "open", n: rollup.open, title: `${rollup.open} open` },
    { kind: "proto", n: rollup.proto, title: `${rollup.proto} proto` },
    { kind: "decided", n: rollup.decided, title: `${rollup.decided} decided` },
    {
      kind: "unchallenged",
      n: rollup.unchallenged,
      title: `${rollup.unchallenged} unchallenged, of ${rollup.decided} decided`,
    },
    { kind: "stale", n: rollup.stale, title: `${rollup.stale} stale` },
    {
      kind: "postponed",
      n: rollup.paused,
      title: `${rollup.paused} postponed`,
    },
  ];
  return counts.filter((count) => count.kind === "total" || count.n > 0);
}
