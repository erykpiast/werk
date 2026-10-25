/** The text that the show verb prints for one card. See #werk-cli-show. */
import type { Edge, FoldedMap, MapNode } from "./fold.ts";

function row(arrow: string, edge: Edge, other: MapNode): string {
  const proposed = other.proposed ? "  [proposed]" : "";
  return `  ${arrow} ${edge.type.padEnd(14)} ${other.id}  ${other.title}${proposed}`;
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
  if (node.body !== "") lines.push("", node.body);
  const edges = [...map.edges, ...map.ghostEdges];
  const links: string[] = [];
  for (const edge of edges) {
    const target = edge.from === id ? map.nodes.get(edge.to) : undefined;
    if (target) links.push(row("->", edge, target));
  }
  for (const edge of edges) {
    const source = edge.to === id ? map.nodes.get(edge.from) : undefined;
    if (source) links.push(row("<-", edge, source));
  }
  if (links.length > 0) lines.push("", ...links);
  return lines.join("\n");
}
