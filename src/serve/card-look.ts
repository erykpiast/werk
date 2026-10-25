/**
 * What a card looks like wherever it is drawn: the status edge, the stale tint, the postponed
 * stripes, the proposed border, and the who label with its ring (#vi-onview-look).
 * The page of a card and its tile use the same marks, so a card reads the same in both.
 */
import type { MapNode, Who } from "../map/fold.ts";
import { isPostponed } from "../map/rollup.ts";

const WHO_LABEL: Record<Who, string> = {
  you: "you decide",
  me: "I decide",
  prototype: "build it first",
};

export const POSTPONED_HINT = "Postponed, not wrong: the work waits.";
export const UNCHALLENGED_HINT = "No option was weighed against this card.";

/** The classes of a card box. The edge carries the status only; staleness tints the background. */
export function cardClasses(node: MapNode): string {
  const classes = [
    "card-box",
    `status-${node.kind === "card" ? node.status : node.kind}`,
  ];
  if (node.marks.some((m) => m.kind === "stale")) classes.push("is-stale");
  if (isPostponed(node)) classes.push("is-postponed");
  if (node.proposed) classes.push("is-proposed");
  return classes.join(" ");
}

/** The who label, or null when the card has no decider yet. */
export function whoLabel(node: MapNode): string | null {
  return node.who === null ? null : WHO_LABEL[node.who];
}

/** The ring of a card that no option was weighed against, or an empty string. */
export function unchallengedRing(node: MapNode): string {
  return node.unchallenged === null
    ? ""
    : `<span class="ring ring-unchallenged" role="img" aria-label="${UNCHALLENGED_HINT}" title="${UNCHALLENGED_HINT}">○</span>`;
}
