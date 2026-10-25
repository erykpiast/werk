/**
 * The page of one card: a hero box on top, then the sections that carry its proof and its marks,
 * then its sub-cards as tiles. Every card has this shape, the root included (#vi-onview,
 * #vi-onview-hero, #vi-onview-root, #vi-detail, #vi-onview-links, #vi-onview-stale).
 */
import type { Edge, FoldedMap, LinkType, MapNode } from "../map/fold.ts";
import { isPostponed, type Rollup, rollups } from "../map/rollup.ts";
import { escapeHtml } from "../md/escape.ts";
import {
  cardHref,
  renderInline,
  renderMarkdown,
  renderTitle,
} from "../md/markdown.ts";
import {
  cardClasses,
  hasProposal,
  POSTPONED_HINT,
  UNCHALLENGED_HINT,
  whoLabel,
} from "./card-look.ts";
import { renderCardTile } from "./card-tile.ts";
import { diffBody, diffInline } from "./diff-html.ts";
import { rollupBar, rollupFlags, rollupLine } from "./rollup-html.ts";

/** The edges of the map, held ones last. */
function allEdges(map: FoldedMap): Edge[] {
  return [...map.edges, ...map.ghostEdges];
}

/** The nodes at the other end of the edges of one type that leave (out) or reach (in) the card. */
function linked(
  map: FoldedMap,
  id: string,
  type: LinkType,
  direction: "out" | "in",
): { node: MapNode; edge: Edge }[] {
  const found: { node: MapNode; edge: Edge }[] = [];
  for (const edge of allEdges(map)) {
    if (edge.type !== type) continue;
    const otherId =
      direction === "out"
        ? edge.from === id
          ? edge.to
          : undefined
        : edge.to === id
          ? edge.from
          : undefined;
    const node = otherId === undefined ? undefined : map.nodes.get(otherId);
    if (node) found.push({ node, edge });
  }
  return found;
}

/** Real nodes before ghosts, each group in log order. */
function realFirst<T extends { node: MapNode }>(items: T[]): T[] {
  return [
    ...items.filter((i) => !i.node.proposed),
    ...items.filter((i) => i.node.proposed),
  ];
}

/** The number of refines links from the card up to the root. */
function depthOf(map: FoldedMap, id: string): number {
  let depth = 0;
  const seen = new Set([id]);
  for (
    let up = map.parents.get(id);
    up !== undefined && !seen.has(up);
    up = map.parents.get(up)
  ) {
    seen.add(up);
    depth += 1;
  }
  return depth;
}

function tag(text: string, extra = "", title = ""): string {
  const hint = title === "" ? "" : ` title="${escapeHtml(title)}"`;
  return `<span class="tag ${extra}"${hint}>${escapeHtml(text)}</span>`;
}

/** The row of tags: the id that copies itself, the kind, the status, each mark as a word, the who label. */
function tagRow(node: MapNode): string {
  const tags = [
    `<button type="button" class="tag tag-id" data-copy="${escapeHtml(node.id)}" title="Copy the id">#${escapeHtml(node.id)}</button>`,
    tag(node.kind, "tag-kind"),
    tag(node.status, `tag-status status-${node.status}`),
  ];
  if (node.marks.some((m) => m.kind === "stale")) {
    tags.push(tag("stale", "tag-stale"));
  }
  if (isPostponed(node)) {
    tags.push(tag("postponed", "tag-postponed", POSTPONED_HINT));
  }
  if (hasProposal(node)) {
    tags.push(
      tag(
        "proposed",
        node.removal ? "tag-proposed tag-removal" : "tag-proposed",
      ),
    );
  }
  if (node.unchallenged !== null) {
    tags.push(tag("no option weighed", "tag-unchallenged", UNCHALLENGED_HINT));
  }
  const who = whoLabel(node);
  if (who !== null) tags.push(tag(who, "tag-who"));
  return `<div class="tags">${tags.join(" ")}</div>`;
}

/** The cards of the refines subtree below a card, ghosts included, in the order that the tree holds them. */
function descendants(map: FoldedMap, id: string): string[] {
  const found: string[] = [];
  // `found` grows while the loop walks it, so grandchildren are visited too.
  for (let i = -1; i < found.length; i++) {
    const card = i < 0 ? id : found[i];
    for (const [child, parent] of map.parents) {
      if (parent === card) found.push(child);
    }
  }
  return found;
}

/**
 * The ✓ that accepts the proposal on the card, and the ✕ that removes it (#al-diff-cli-btn, #vi-remove-btn).
 * The ✕ carries what its confirmation names: the cards that go with the whole subtree, the children
 * that would move up, and the parent they move to (#vi-remove-btn-reparent). A proposed card is discarded,
 * not removed, so it has no ✕.
 */
function actions(map: FoldedMap, node: MapNode): string {
  const buttons: string[] = [];
  if (hasProposal(node)) {
    const kind = node.removal ? " is-removal" : "";
    buttons.push(
      `<button type="button" class="card-action card-accept${kind}" data-action="accept" data-card="${escapeHtml(node.id)}" title="Accept the proposal" aria-label="Accept the proposal">✓</button>`,
    );
  }
  if ((node.kind === "card" || node.kind === "option") && !node.proposed) {
    const below = descendants(map, node.id);
    const children = [...map.parents].filter(([, p]) => p === node.id).length;
    const parent = map.parents.get(node.id);
    const parentNode = parent === undefined ? undefined : map.nodes.get(parent);
    const up =
      parentNode === undefined
        ? ""
        : ` data-parent="${escapeHtml(parentNode.id)}" data-parent-title="${escapeHtml(parentNode.title)}"`;
    buttons.push(
      `<button type="button" class="card-action card-remove" data-action="remove" data-card="${escapeHtml(node.id)}" data-cards="${below.length + 1}" data-children="${children}"${up} title="Remove this card" aria-label="Remove this card">✕</button>`,
    );
  }
  return buttons.length === 0
    ? ""
    : `<div class="card-actions">${buttons.join("")}</div>`;
}

function hero(
  map: FoldedMap,
  node: MapNode,
  rollup: Rollup | undefined,
): string {
  const known = (ref: string) => map.nodes.has(ref);
  const depth = Math.min(depthOf(map, node.id), 2);
  const { pending } = node;
  const title =
    pending?.title === undefined
      ? renderTitle(node.title)
      : diffInline(node.title, pending.title, renderTitle);
  const why =
    pending?.why === undefined
      ? renderInline(node.why, known)
      : diffInline(node.why, pending.why, (text) => renderInline(text, known));
  const parts = [
    actions(map, node),
    tagRow(node),
    `<h1 class="title title-depth-${depth}">${title}</h1>`,
  ];
  if (node.why !== "" || pending?.why !== undefined) {
    parts.push(`<p data-part="why">${why}</p>`);
  }
  if (pending?.ops !== undefined) {
    parts.push(`<div data-part="body">${diffBody(pending.ops, known)}</div>`);
  } else if (node.body !== "") {
    parts.push(
      `<div data-part="body">${renderMarkdown(node.body, known)}</div>`,
    );
  }
  if (rollup) {
    parts.push(rollupBar(rollup), rollupLine(rollup), rollupFlags(rollup));
  }
  return `<section class="hero ${cardClasses(node)}" aria-label="Card">${parts.join("")}</section>`;
}

function section(heading: string, content: string, extra = ""): string {
  return `<section class="page-section ${extra}"><h2>${heading}</h2>${content}</section>`;
}

/** One block per mark of a kind: the trace that the mark carries (#vi-prop-trace). */
function traces(node: MapNode): string {
  const block = (kinds: string[], heading: string, extra: string) => {
    const marks = node.marks.filter((m) => kinds.includes(m.kind));
    if (marks.length === 0) return "";
    const blocks = marks.map(
      (m) => `<pre class="trace">${escapeHtml(m.trace)}</pre>`,
    );
    return section(heading, blocks.join(""), extra);
  };
  return (
    block(["stale"], "Why this card is stale", "trace-stale") +
    block(
      ["paused", "postponed"],
      "Why this card is postponed",
      "trace-postponed",
    )
  );
}

/** One row of a link list: the label, the id, the title, and the reason (#vi-onview-links). */
function linkRow(
  label: string,
  other: MapNode,
  reason: string,
  known: (id: string) => boolean,
): string {
  const text =
    reason === ""
      ? ""
      : `<span class="link-why">${renderInline(reason, known)}</span>`;
  return `<li class="link-row"><span class="link-label">${label}</span> <a class="card-ref" href="${cardHref(other.id)}"><span class="card-id">#${escapeHtml(other.id)}</span> ${renderTitle(other.title)}</a> ${text}</li>`;
}

function linkList(heading: string, rows: string[]): string {
  return rows.length === 0
    ? ""
    : section(heading, `<ul class="link-list">${rows.join("")}</ul>`);
}

/** The mark on a link that waits for the ✓ of its ghost end (#werk-propose-new). */
const PENDING_LINK = ` <span class="tag tag-pending-link" title="This link waits for the ✓ of the card at its other end">pending</span>`;

/** The words of a piece of evidence: its why line and its body. */
function evidenceRow(map: FoldedMap, node: MapNode, held: boolean): string {
  const known = (id: string) => map.nodes.has(id);
  const words = [
    node.why === ""
      ? ""
      : `<div class="words-why">${renderInline(node.why, known)}</div>`,
    node.body === ""
      ? ""
      : `<div class="words-body">${renderMarkdown(node.body, known)}</div>`,
  ].join("");
  return `<li class="evidence-row ${cardClasses(node)}" data-card-id="${escapeHtml(node.id)}"><a class="card-ref" href="${cardHref(node.id)}"><span class="link-label">${node.kind}</span> <span class="card-id">#${escapeHtml(node.id)}</span> ${renderTitle(node.title)}</a>${held ? PENDING_LINK : ""}${words}</li>`;
}

/** The tiles of the cards that refine the card, real ones first, under a heading that counts them (#vi-onview-subcards). */
function subCardsSection(
  map: FoldedMap,
  id: string,
  all: Record<string, Rollup>,
): string {
  const subs = realFirst(linked(map, id, "refines", "in")).filter(
    ({ node: sub }) => sub.kind === "card",
  );
  if (subs.length === 0) return "";
  const ghosts = subs.filter(({ node: sub }) => sub.proposed).length;
  const count = `<span class="count">${subs.length}</span>${ghosts > 0 ? ` <span class="count-proposed">${ghosts} proposed</span>` : ""}`;
  return section(
    `Sub-cards ${count}`,
    `<div class="tile-grid">${subs.map(({ node: sub }) => renderCardTile(map, sub, all[sub.id])).join("")}</div>`,
    "sub-cards",
  );
}

function sections(
  map: FoldedMap,
  node: MapNode,
  all: Record<string, Rollup>,
): string {
  const known = (id: string) => map.nodes.has(id);
  const id = node.id;
  const options = realFirst(linked(map, id, "alternative_to", "in")).map(
    ({ node: option }) => renderCardTile(map, option, undefined),
  );
  const evidence = realFirst(linked(map, id, "supported_by", "out")).map(
    ({ node: item, edge }) =>
      evidenceRow(map, item, map.ghostEdges.includes(edge)),
  );
  const citedBy = realFirst(linked(map, id, "supported_by", "in")).map(
    ({ node: card }) => linkRow("Cited by", card, card.why, known),
  );
  const dependsOn = realFirst(linked(map, id, "depends_on", "out")).map(
    ({ node: other, edge }) => linkRow("Depends on", other, edge.why, known),
  );
  const dependents = realFirst(linked(map, id, "depends_on", "in")).map(
    ({ node: other, edge }) => linkRow("Dependent", other, edge.why, known),
  );
  return [
    traces(node),
    options.length === 0
      ? ""
      : section("Options", `<div class="tile-grid">${options.join("")}</div>`),
    evidence.length === 0
      ? ""
      : section(
          "Evidence and excerpts",
          `<ul class="evidence-list">${evidence.join("")}</ul>`,
        ),
    linkList("Cited by", citedBy),
    linkList("Depends on", dependsOn),
    linkList("Depend on this card", dependents),
    subCardsSection(map, id, all),
  ].join("");
}

/** The whole page of one card, as the article that the left pane shows. */
export function renderCardPage(map: FoldedMap, node: MapNode): string {
  const all = rollups(map);
  return `<article class="card-page">${hero(map, node, all[node.id])}${sections(map, node, all)}</article>`;
}

/** The column of one top card on the home view: its hero and its sub-cards, and no other section (#vi-home-howwhat). */
export function renderCardColumn(map: FoldedMap, node: MapNode): string {
  const all = rollups(map);
  return `<article class="card-page">${hero(map, node, all[node.id])}${subCardsSection(map, node.id, all)}</article>`;
}
