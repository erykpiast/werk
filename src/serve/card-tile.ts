/**
 * A tile: one link to the page of a card, with its title, its why line, one meta row and a rollup
 * bar (#vi-onview-subcards). Nothing inside it is a link, so the why line shows a reference and
 * does not link it (#werk-reflink). An option uses the same tile under Options.
 */
import type { FoldedMap, MapNode } from "../map/fold.ts";
import type { Rollup } from "../map/rollup.ts";
import { escapeHtml } from "../md/escape.ts";
import { cardHref, renderTile, renderTitle } from "../md/markdown.ts";
import {
  cardClasses,
  hasProposal,
  unchallengedRing,
  whoLabel,
} from "./card-look.ts";
import { cardsBelow, rollupBar } from "./rollup-html.ts";

/** The count of evidence nodes that a card cites. */
function evidenceCount(map: FoldedMap, id: string): number {
  return [...map.edges, ...map.ghostEdges].filter(
    (e) => e.type === "supported_by" && e.from === id && map.nodes.has(e.to),
  ).length;
}

export function renderCardTile(
  map: FoldedMap,
  node: MapNode,
  rollup: Rollup | undefined,
): string {
  const known = (ref: string) => map.nodes.has(ref);
  const meta = [`<span class="card-id">#${escapeHtml(node.id)}</span>`];
  if (hasProposal(node)) {
    meta.push(`<span class="tag tag-proposed">proposed</span>`);
  }
  const below = rollup ? cardsBelow(rollup) : 0;
  if (below > 0) meta.push(`<span class="meta-below">${below} below</span>`);
  const evidence = evidenceCount(map, node.id);
  if (evidence > 0) {
    meta.push(`<span class="meta-evidence">${evidence} evidence</span>`);
  }
  const who = whoLabel(node);
  if (who !== null) meta.push(`<span class="who">${who}</span>`);
  meta.push(unchallengedRing(node));
  const why =
    node.why === ""
      ? ""
      : `<div class="tile-why">${renderTile(node.why, known)}</div>`;
  return `<a class="tile ${cardClasses(node)}" href="${cardHref(node.id)}" data-card-id="${escapeHtml(node.id)}"><div class="tile-title">${renderTitle(node.title)}</div>${why}<div class="tile-meta">${meta.join(" ")}</div>${rollup ? rollupBar(rollup) : ""}</a>`;
}
