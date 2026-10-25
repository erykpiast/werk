/**
 * The open card of the left pane, rendered to HTML on the server. The page swaps this HTML in and
 * never hydrates it (#werk-stack-hydration, #vi-onview).
 */
import type { FoldedMap } from "../map/fold.ts";
import { escapeHtml } from "../md/escape.ts";
import { renderInline, renderMarkdown, renderTitle } from "../md/markdown.ts";

const ROOT_ID = "root";

export type OpenCard = { id: string; html: string };

/** The card with the id root, else the first card that refines no other card, else null. */
export function openCardId(map: FoldedMap): string | null {
  const cards = [...map.nodes.values()].filter((n) => n.kind === "card");
  if (cards.some((card) => card.id === ROOT_ID)) return ROOT_ID;
  return cards.find((card) => !map.parents.has(card.id))?.id ?? null;
}

/** The ids of the cards that refine the card directly, in the order of the map. */
function subCardIds(map: FoldedMap, id: string): string[] {
  return [...map.edges, ...map.ghostEdges]
    .filter((e) => e.type === "refines" && e.to === id)
    .map((e) => e.from)
    .filter((child) => map.nodes.get(child)?.kind === "card");
}

/** The open card with its title, why, body and the titles of its sub-cards, or null for an empty map. */
export function renderOpenCard(map: FoldedMap): OpenCard | null {
  const id = openCardId(map);
  const node = id === null ? undefined : map.nodes.get(id);
  if (id === null || !node) return null;
  const known = (ref: string) => map.nodes.has(ref);
  const parts = [`<h1>${renderTitle(node.title)}</h1>`];
  if (node.why !== "") {
    parts.push(`<p data-part="why">${renderInline(node.why, known)}</p>`);
  }
  if (node.body !== "") {
    parts.push(
      `<div data-part="body">${renderMarkdown(node.body, known)}</div>`,
    );
  }
  const subs = subCardIds(map, id).map((child) => {
    const title = map.nodes.get(child)?.title ?? "";
    return `<li data-card-id="${escapeHtml(child)}">${renderTitle(title)}</li>`;
  });
  if (subs.length > 0) {
    parts.push(`<ul aria-label="Sub-cards">${subs.join("")}</ul>`);
  }
  return { id, html: `<article>${parts.join("")}</article>` };
}
