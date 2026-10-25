/** The text that the show verb prints for one card. See #werk-cli-show. */
import type { Edge, FoldedMap, MapNode } from "./fold.ts";
import { rollup, rollupText } from "./rollup.ts";

function row(
  arrow: string,
  edge: Edge,
  other: MapNode,
  map: FoldedMap,
): string {
  const parts = [
    `  ${arrow} ${edge.type.padEnd(14)} ${other.id}  ${other.title}`,
  ];
  if (other.proposed) parts.push("  [proposed]");
  const childRollup =
    arrow === "<-" && edge.type === "refines" ? rollup(map, other.id) : null;
  if (childRollup) parts.push(`  (${rollupText(childRollup)})`);
  const lines = [parts.join("")];
  if (edge.why !== "") lines.push(`       why: ${edge.why}`);
  return lines.join("\n");
}

/** The printed card, or null when the map has no such card. */
export function renderCard(map: FoldedMap, id: string): string | null {
  const node = map.nodes.get(id);
  if (!node) return null;
  const lines = [
    `${node.kind} ${node.id}  [${node.status}]${node.proposed ? "  proposed" : ""}`,
    node.title,
  ];
  if (node.why !== "") lines.push(`why: ${node.why}`);
  const own = rollup(map, id);
  if (own) lines.push(`subtree: ${rollupText(own)}`);
  if (node.whyNot !== null) lines.push(`why not: ${node.whyNot}`);
  if (node.url !== null) lines.push(`url: ${node.url}`);
  if (node.finding !== null) lines.push(`finding: ${node.finding}`);
  if (node.body !== "") lines.push("", node.body);
  const edges = [...map.edges, ...map.ghostEdges];
  const links: string[] = [];
  for (const edge of edges) {
    const target = edge.from === id ? map.nodes.get(edge.to) : undefined;
    if (target) links.push(row("->", edge, target, map));
  }
  for (const edge of edges) {
    const source = edge.to === id ? map.nodes.get(edge.from) : undefined;
    if (source) links.push(row("<-", edge, source, map));
  }
  if (links.length > 0) lines.push("", ...links);
  return lines.join("\n");
}
