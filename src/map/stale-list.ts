/**
 * The list that the stale verb prints. See #werk-cli-stale and #map-wait.
 * One entry per marked card, with the basis of a card before the card (#rederive-reason).
 */
import type { FoldedMap, MapNode } from "./fold.ts";
import { basisOf, basisWaiting } from "./mark-rules.ts";

export type MarkKind = "stale" | "paused" | "waiting";
export const MARK_KINDS: readonly MarkKind[] = ["stale", "paused", "waiting"];

export type Marked = { node: MapNode; kind: MarkKind; lines: string[] };

/** A stale card is stale. A card with only paused or postponed marks is paused. An unmarked card on a basis that does not hold waits. */
function classify(map: FoldedMap, node: MapNode): Marked | null {
  const stale = node.marks.filter((m) => m.kind === "stale");
  if (stale.length > 0) {
    return {
      node,
      kind: "stale",
      lines: stale.map((m) => m.trace.split("\n")[0] as string),
    };
  }
  if (node.marks.length > 0) {
    return {
      node,
      kind: "paused",
      lines: node.marks.map((m) => m.trace.split("\n")[0] as string),
    };
  }
  if (node.status === "decided") return null;
  const waiting = basisWaiting(map, node);
  if (waiting.length === 0) return null;
  return {
    node,
    kind: "waiting",
    lines: waiting.map(
      (t) =>
        `waits for #${t.id} (${t.status === "decided" ? "stale" : t.status})`,
    ),
  };
}

/** The ids of a card and its refines subtree. */
function subtree(map: FoldedMap, root: string): Set<string> {
  const ids = new Set([root]);
  for (const id of ids) {
    for (const [child, parent] of map.parents) {
      if (parent === id) ids.add(child);
    }
  }
  return ids;
}

/** The marked cards of the map, or of one subtree, with a basis listed before the card on it. */
export function listMarked(
  map: FoldedMap,
  root: string | null,
  kind: MarkKind | null,
): Marked[] {
  const scope = root === null ? null : subtree(map, root);
  const found = new Map<string, Marked>();
  for (const node of map.nodes.values()) {
    if (node.kind !== "card" || node.proposed) continue;
    if (scope !== null && !scope.has(node.id)) continue;
    const marked = classify(map, node);
    if (marked && (kind === null || marked.kind === kind)) {
      found.set(node.id, marked);
    }
  }
  const ordered: Marked[] = [];
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    const marked = found.get(id) as Marked;
    for (const basis of basisOf(map, marked.node)) {
      if (found.has(basis.id)) visit(basis.id);
    }
    ordered.push(marked);
  };
  for (const id of found.keys()) visit(id);
  return ordered;
}

/** The printed list: one line per card, and under it one line per mark. */
export function renderMarked(entries: readonly Marked[]): string {
  if (entries.length === 0) return "nothing is marked";
  return entries
    .flatMap(({ node, kind, lines }) => [
      `${kind.padEnd(8)} ${node.id}  ${node.title}`,
      ...lines.map((line) => `         ${line}`),
    ])
    .join("\n");
}
