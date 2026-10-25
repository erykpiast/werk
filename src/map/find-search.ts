/**
 * The queries behind the find and search verbs. See #werk-find-scope and #werk-cli-search.
 * Only real cards are listed: a ghost is held out of the map, and a removed card is not in it.
 */
import type { FoldedMap, MapNode, Status } from "./fold.ts";

/** The ids of a card and its refines subtree, breadth first, the card itself first. */
function subtreeOrder(map: FoldedMap, root: string): string[] {
  const order = [root];
  for (const id of order) {
    for (const [child, parent] of map.parents) {
      if (parent === id && !order.includes(child)) order.push(child);
    }
  }
  return order;
}

const isRealCard = (node: MapNode | undefined): node is MapNode =>
  node !== undefined && node.kind === "card" && !node.proposed;

/**
 * The open and proto cards that can be worked on now, breadth first from `root`,
 * or from each tree of the map when `root` is null. A card with any mark waits (#pr-wf-postponed).
 */
export function findOpen(map: FoldedMap, root: string | null): MapNode[] {
  const roots =
    root === null
      ? [...map.nodes.values()]
          .filter((node) => !map.parents.has(node.id))
          .map((node) => node.id)
      : [root];
  const seen = new Set<string>();
  const found: MapNode[] = [];
  for (const start of roots) {
    for (const id of subtreeOrder(map, start)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = map.nodes.get(id);
      if (!isRealCard(node) || node.status === "decided") continue;
      if (node.marks.length > 0) continue;
      found.push(node);
    }
  }
  return found;
}

export type SearchQuery = {
  terms: readonly string[];
  status: Status | null;
  under: string | null;
};

/** The words of a card that a term can hit: its own text and the why-not of each of its options. */
function wordsOf(map: FoldedMap, node: MapNode): string[] {
  const whyNots = map.edges
    .filter((edge) => edge.type === "alternative_to" && edge.to === node.id)
    .map((edge) => map.nodes.get(edge.from))
    .filter((option) => option !== undefined && !option.proposed)
    .map((option) => option?.why ?? "");
  return [node.title, node.why, node.body, ...whyNots].map((text) =>
    text.toLowerCase(),
  );
}

function countIn(text: string, term: string): number {
  let count = 0;
  for (
    let at = text.indexOf(term);
    at !== -1;
    at = text.indexOf(term, at + 1)
  ) {
    count += 1;
  }
  return count;
}

/**
 * The cards that hold every term, the most hits first and map order among equals.
 * With no term, the cards of the status that the query names, or the decided cards.
 */
export function searchCards(map: FoldedMap, query: SearchQuery): MapNode[] {
  // An empty term occurs everywhere and would never end the occurrence count.
  const terms = query.terms
    .filter((term) => term !== "")
    .map((term) => term.toLowerCase());
  const status = query.status ?? (terms.length === 0 ? "decided" : null);
  const scope =
    query.under === null ? null : new Set(subtreeOrder(map, query.under));
  const hits: { node: MapNode; hits: number }[] = [];
  for (const node of map.nodes.values()) {
    if (!isRealCard(node)) continue;
    if (status !== null && node.status !== status) continue;
    if (scope !== null && !scope.has(node.id)) continue;
    const words = wordsOf(map, node);
    const perTerm = terms.map((term) =>
      words.reduce((sum, text) => sum + countIn(text, term), 0),
    );
    if (perTerm.some((count) => count === 0)) continue;
    hits.push({ node, hits: perTerm.reduce((sum, count) => sum + count, 0) });
  }
  // The sort is stable, so equal hits keep the map order.
  return hits.sort((a, b) => b.hits - a.hits).map((entry) => entry.node);
}

/** One line per card: the id, the status and the title. */
export function renderMatches(nodes: readonly MapNode[]): string {
  return nodes
    .map((node) => `${node.id}  [${node.status}]  ${node.title}`)
    .join("\n");
}

/** The index: one line per card, the id and the title. */
export function renderIndex(nodes: readonly MapNode[]): string {
  return nodes.map((node) => `${node.id}  ${node.title}`).join("\n");
}
