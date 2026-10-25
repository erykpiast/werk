/** The text that the show verb prints for one card. See #werk-cli-show. */
import { renderPending } from "./edit-diff.ts";
import type { Criterion, Edge, FoldedMap, MapNode } from "./fold.ts";
import { type Rollup, rollups } from "./rollup.ts";
import { threadLines } from "./thread.ts";

/** One line of counts. The three status counts add up to the card count (#rollup). */
function rollupText(rollup: Rollup): string {
  return `rollup: ${rollup.cards} cards: ${rollup.open} open, ${rollup.proto} proto, ${rollup.decided} decided`;
}

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

function row(
  arrow: string,
  edge: Edge,
  other: MapNode,
  held: boolean,
  rollup?: Rollup,
): string {
  const proposed = other.proposed ? "  [proposed]" : "";
  const heldMark = held ? "  [held]" : "";
  const counts = rollup && rollup.cards > 0 ? `  (${rollupText(rollup)})` : "";
  const why = edge.why === "" ? "" : `\n      why: ${edge.why}`;
  return `  ${arrow} ${edge.type.padEnd(14)} ${other.id}  ${other.title}${proposed}${heldMark}${counts}${why}`;
}

/** The card that show prints when no id is given: the first card that refines no other. */
export function rootCardId(map: FoldedMap): string | null {
  for (const node of map.nodes.values()) {
    if (node.kind === "card" && !node.proposed && !map.parents.has(node.id)) {
      return node.id;
    }
  }
  return null;
}

function section(
  heading: string,
  map: FoldedMap,
  ids: string[],
  line: (node: MapNode) => string,
): string[] {
  const nodes = ids.flatMap((id) => map.nodes.get(id) ?? []);
  if (nodes.length === 0) return [];
  return ["", `${heading}:`, ...nodes.map(line)];
}

/** The printed card, or null when the map has no such card. */
export function renderCard(map: FoldedMap, id: string): string | null {
  const node = map.nodes.get(id);
  if (!node) return null;
  const lines = [
    `${node.kind} ${node.id}  [${node.status}]${node.proposed ? "  proposed" : ""}${node.pending ? "  pending change" : ""}`,
    node.title,
  ];
  const all = rollups(map);
  const own = all[id];
  if (own) lines.push(rollupText(own));
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
  // An option, an excerpt and a source print in their own sections, with their words (#vi-detail-cli-proof).
  const sectioned = (edge: Edge) =>
    edge.type === "alternative_to" || edge.type === "supported_by";
  const links: string[] = [];
  for (const { edge, held } of edges) {
    const target = edge.from === id ? map.nodes.get(edge.to) : undefined;
    if (target && !sectioned(edge)) links.push(row("->", edge, target, held));
  }
  for (const { edge, held } of edges) {
    const source = edge.to === id ? map.nodes.get(edge.from) : undefined;
    if (source && !sectioned(edge)) {
      links.push(
        row(
          "<-",
          edge,
          source,
          held,
          edge.type === "refines" ? all[source.id] : undefined,
        ),
      );
    }
  }
  if (links.length > 0) lines.push("", ...links);
  const from = (type: Edge["type"], end: "from" | "to") =>
    edges
      .filter(
        ({ edge }) =>
          edge.type === type && edge[end === "from" ? "to" : "from"] === id,
      )
      .map(({ edge }) => edge[end]);
  const flag = (n: MapNode) => (n.proposed ? "  proposed" : "");
  lines.push(
    ...section(
      "Options",
      map,
      from("alternative_to", "from"),
      (n) =>
        `  ${n.id}  ${n.title}${flag(n)}${n.why === "" ? "" : `\n      why not: ${n.why}`}`,
    ),
  );
  const cited = from("supported_by", "to");
  const kindOf = (kind: MapNode["kind"]) =>
    cited.filter((c) => map.nodes.get(c)?.kind === kind);
  lines.push(
    ...section(
      "Say",
      map,
      kindOf("excerpt"),
      (n) => `  ${n.pointer?.speaker ?? "?"}: ${n.title}${flag(n)}`,
    ),
    ...section(
      "Ev",
      map,
      kindOf("source"),
      (n) =>
        `  ${n.id}  ${n.title}${flag(n)}${n.why === "" ? "" : `\n      finding: ${n.why}`}`,
    ),
  );
  const thread = map.threads.get(id) ?? [];
  if (thread.length > 0) lines.push("", "thread:", ...threadLines(thread));
  return lines.join("\n");
}
