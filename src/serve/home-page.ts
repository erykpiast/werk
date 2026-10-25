/**
 * The home view: the root of the requirements and the card of the build rules in two columns of equal width.
 * The page swaps this HTML in and never hydrates it (#vi-home-howwhat, #werk-stack-hydration).
 */
import { BUILD_RULES_ID } from "../chat/build-rules.ts";
import type { FoldedMap } from "../map/fold.ts";
import { renderCardColumn } from "./card-page.ts";
import { openCardId } from "./open-card.ts";

const EMPTY_HOW = `<article class="card-page"><section class="empty-how" aria-label="Build rules"><h2>Build rules</h2><p>This map has no build rules yet.</p></section></article>`;

/** The home view, or null for an empty map. */
export function renderHome(map: FoldedMap): string | null {
  const rootId = openCardId(map);
  const root = rootId === null ? undefined : map.nodes.get(rootId);
  if (!root) return null;
  const how = map.nodes.get(BUILD_RULES_ID);
  const hasRules =
    how !== undefined &&
    how.kind === "card" &&
    !how.proposed &&
    [...map.parents.values()].includes(BUILD_RULES_ID);
  return `<div class="home"><div class="home-col home-what" data-slot="home-what">${renderCardColumn(map, root)}</div><div class="home-col home-how" data-slot="home-how">${hasRules && how ? renderCardColumn(map, how) : EMPTY_HOW}</div></div>`;
}
