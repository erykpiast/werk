/**
 * The open card of the left pane, rendered to HTML on the server (#vi-onview-root). The page swaps this HTML in and
 * never hydrates it (#werk-stack-hydration, #vi-onview).
 */
import type { FoldedMap } from "../map/fold.ts";
import { escapeHtml } from "../md/escape.ts";
import { renderCardPage } from "./card-page.ts";

const ROOT_ID = "root";

export type OpenCard = { id: string; html: string };

/** The card with the id root, else the first card that refines no other card, else null. */
export function openCardId(map: FoldedMap): string | null {
  const cards = [...map.nodes.values()].filter((n) => n.kind === "card");
  if (cards.some((card) => card.id === ROOT_ID)) return ROOT_ID;
  return cards.find((card) => !map.parents.has(card.id))?.id ?? null;
}

/** The page of the card with this id, the page of the open card when none is named, or null for an empty map. */
export function renderOpenCard(
  map: FoldedMap,
  wanted?: string,
): OpenCard | null {
  if (wanted !== undefined && !map.nodes.has(wanted)) {
    return {
      id: wanted,
      html: `<article class="card-page"><p class="not-found">The map has no card ${escapeHtml(wanted)}.</p></article>`,
    };
  }
  const id = wanted ?? openCardId(map);
  const node = id === null ? undefined : map.nodes.get(id);
  if (id === null || !node) return null;
  return { id, html: renderCardPage(map, node) };
}
