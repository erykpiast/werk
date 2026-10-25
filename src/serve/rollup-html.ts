/**
 * The rollup of a card as HTML: a bar of widths, a labelled count line, and chips for the flags.
 * The numbers come from the server's one rollup (#rollup, #ro-axes, #vi-counts, #vi-counts-card).
 * Nothing but the three statuses may sit in the bar or the dot row, because a flag cuts across them.
 */
import type { Status } from "../map/fold.ts";
import type { Rollup } from "../map/rollup.ts";

/** The order of the bar, left to right: how much is done, then how much is left. */
const BAR_ORDER: readonly Status[] = ["decided", "open", "proto"];
/** The order of the dots in the count line (#vi-counts). */
const DOT_ORDER: readonly Status[] = ["open", "proto", "decided"];

/** The number of cards below the card itself. A real card's rollup counts the card too. */
export function cardsBelow(rollup: Rollup): number {
  return Math.max(0, rollup.cards - 1);
}

function width(count: number, total: number): string {
  return `${((count / total) * 100).toFixed(2)}%`;
}

/** The bar. A postponed card keeps the width of its status and is hatched inside it (#vi-onview-postponed). Empty for a leaf. */
export function rollupBar(rollup: Rollup): string {
  if (cardsBelow(rollup) === 0) return "";
  const segments: string[] = [];
  for (const status of BAR_ORDER) {
    const hatched = rollup.pausedBy[status];
    const plain = rollup[status] - hatched;
    if (plain > 0) {
      segments.push(
        `<span class="seg seg-${status}" style="width:${width(plain, rollup.cards)}"></span>`,
      );
    }
    if (hatched > 0) {
      segments.push(
        `<span class="seg seg-${status} seg-postponed" style="width:${width(hatched, rollup.cards)}"></span>`,
      );
    }
  }
  const label = DOT_ORDER.map((s) => `${rollup[s]} ${s}`).join(", ");
  return `<span class="rollup-bar" role="img" aria-label="${label}">${segments.join("")}</span>`;
}

/** The line that names its scope, with the total and a word after each number. Zeros are left out. */
export function rollupLine(rollup: Rollup): string {
  if (cardsBelow(rollup) === 0) return "";
  const parts = [
    `<span class="scope">this card and everything below it, ${rollup.cards} cards</span>`,
  ];
  for (const status of DOT_ORDER) {
    if (rollup[status] > 0) {
      parts.push(
        `<span class="count dot dot-${status}"><span aria-hidden="true">●</span> ${rollup[status]} ${status}</span>`,
      );
    }
  }
  const rings: [string, number][] = [
    ["unchallenged", rollup.unchallenged],
    ["stale", rollup.stale],
    ["postponed", rollup.paused],
  ];
  for (const [name, count] of rings) {
    if (count > 0) {
      parts.push(
        `<span class="count ring ring-${name}"><span aria-hidden="true">○</span> ${count} ${name}</span>`,
      );
    }
  }
  return `<p class="rollup-line">${parts.join(" ")}</p>`;
}

/** The chips for what is wrong. They cut across status, so they are never in the line (#ro-axes). */
export function rollupFlags(rollup: Rollup): string {
  const chips: string[] = [];
  if (rollup.unchallenged > 0) {
    chips.push(
      `<span class="chip chip-unchallenged">${rollup.unchallenged} of ${rollup.decided} decided had no option presented</span>`,
    );
  }
  if (rollup.stale > 0) {
    chips.push(`<span class="chip chip-stale">${rollup.stale} stale</span>`);
  }
  return chips.length === 0
    ? ""
    : `<div class="rollup-flags">${chips.join(" ")}</div>`;
}
