/** The text that the show verb prints for one card. See #werk-cli-show. */
import { renderPending } from "./edit-diff.ts";
import type { Criterion, Edge, FoldedMap, MapNode } from "./fold.ts";
import { threadLines } from "./thread.ts";

function killText(criterion: Criterion): string {
  switch (criterion.form) {
    case "metric":
      return `${criterion.metric} ${criterion.threshold} over ${criterion.window}, sample ${criterion.sample}, from ${criterion.source}`;
    case "manual":
      return `manual test: ${criterion.test}`;
    case "no-metric":
      return `no metric: ${criterion.reason}`;
    case "revisit":
      return "revisit at any time";
  }
}

function row(arrow: string, edge: Edge, other: MapNode, held: boolean): string {
  const proposed = other.proposed ? "  [proposed]" : "";
  const heldMark = held ? "  [held]" : "";
  const why = edge.why === "" ? "" : `\n      why: ${edge.why}`;
  return `  ${arrow} ${edge.type.padEnd(14)} ${other.id}  ${other.title}${proposed}${heldMark}${why}`;
}

/** The printed card, or null when the map has no such card. */
export function renderCard(map: FoldedMap, id: string): string | null {
  const node = map.nodes.get(id);
  if (!node) return null;
  const lines = [
    `${node.kind} ${node.id}  [${node.status}]${node.proposed ? "  proposed" : ""}${node.pending ? "  pending change" : ""}`,
    node.title,
  ];
  if (node.pointer) {
    const { speaker, at, conversation, session, message, start, end } =
      node.pointer;
    lines.push(
      `said by ${speaker} at ${at}: conversation ${conversation}, session ${session}, message ${message}, span ${start}..${end}`,
    );
  }
  if (node.why !== "") lines.push(`why: ${node.why}`);
  if (node.body !== "") lines.push("", node.body);
  const facts = [
    ...(node.noBasis === null ? [] : [`basis waived: ${node.noBasis}`]),
    ...(node.unchallenged === null
      ? []
      : [`option waived: ${node.unchallenged}`]),
    ...node.kill.map((criterion) => `kill: ${killText(criterion)}`),
  ];
  if (facts.length > 0) lines.push("", ...facts);
  for (const mark of node.marks) lines.push("", mark.trace);
  if (node.pending) lines.push("", ...renderPending(node, node.pending));
  const edges = [
    ...map.edges.map((edge) => ({ edge, held: false })),
    ...map.ghostEdges.map((edge) => ({ edge, held: true })),
  ];
  const links: string[] = [];
  for (const { edge, held } of edges) {
    const target = edge.from === id ? map.nodes.get(edge.to) : undefined;
    if (target) links.push(row("->", edge, target, held));
  }
  for (const { edge, held } of edges) {
    const source = edge.to === id ? map.nodes.get(edge.from) : undefined;
    if (source) links.push(row("<-", edge, source, held));
  }
  if (links.length > 0) lines.push("", ...links);
  const thread = map.threads.get(id) ?? [];
  if (thread.length > 0) lines.push("", "thread:", ...threadLines(thread));
  return lines.join("\n");
}
