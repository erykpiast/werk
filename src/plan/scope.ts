/** The scope of a plan: the subtree plus every decided card it depends on, followed down and never up (#st-spec-linked). Pure. */
import type { FoldedMap, LogEntry, MapNode } from "../map/fold.ts";

export type Scope = {
  /** The subtree and every card a subtree card links, in the order they were found. */
  first: string[];
  /** The rest of the scope: context that no ticket must cite. */
  second: string[];
  /** The first-tier cards that stop the plan, each with the reason. */
  stops: { id: string; reason: string }[];
};

const REF = /(?<![\w/#:&-])#([A-Za-z0-9][A-Za-z0-9._:-]*)/g;

/** The ids that a text names with a hash sign. Trailing punctuation drops until the token is a known id. */
export function refsIn(text: string, known: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(REF)) {
    let token = match[1] as string;
    while (token !== "" && !known.has(token)) token = token.slice(0, -1);
    if (token !== "" && !found.includes(token)) found.push(token);
  }
  return found;
}

type Kind = "clean" | "stop" | "out";

/** A decided card with no mark is in the scope. An open or proto card with no mark stops a plan. A marked card stays out. */
function kindOf(node: MapNode): Kind {
  if (node.marks.length > 0) return "out";
  return node.status === "decided" ? "clean" : "stop";
}

export function planScope(map: FoldedMap, root: string): Scope {
  const cards = new Map<string, MapNode>();
  for (const node of map.nodes.values()) {
    if (node.kind === "card" && !node.proposed) cards.set(node.id, node);
  }
  const children = new Map<string, string[]>();
  for (const [child, parent] of map.parents) {
    if (!cards.has(child)) continue;
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const dependsOn = new Map<string, string[]>();
  for (const edge of map.edges) {
    if (edge.type !== "depends_on") continue;
    dependsOn.set(edge.from, [...(dependsOn.get(edge.from) ?? []), edge.to]);
  }
  // The way up leads to the whole map, so no ancestor of the root is ever linked.
  const ancestors = new Set<string>();
  for (
    let at = map.parents.get(root);
    at !== undefined && !ancestors.has(at);
    at = map.parents.get(at)
  ) {
    ancestors.add(at);
  }

  const first: string[] = [];
  const second: string[] = [];
  const stops: Scope["stops"] = [];
  const seen = new Set<string>();

  /** Adds a card and, going down, each clean card below it. */
  const take = (id: string, into: string[], stopHere: boolean): void => {
    const node = cards.get(id);
    if (!node || seen.has(id)) return;
    seen.add(id);
    const kind = kindOf(node);
    if (kind === "stop" && stopHere) {
      stops.push({ id, reason: node.status });
    }
    if (kind !== "clean") return;
    into.push(id);
    for (const child of children.get(id) ?? []) take(child, into, stopHere);
  };

  take(root, first, true);
  // The root itself, when it is out or stops, leaves a scope with nothing to plan.
  if (first.length === 0 && stops.length === 0) {
    stops.push({ id: root, reason: "marked, so out of every plan" });
  }

  const known = new Set(cards.keys());
  const subtree = [...first];
  const linkedCards: string[] = [];
  for (const id of subtree) {
    const node = cards.get(id) as MapNode;
    const linked = [
      ...(dependsOn.get(id) ?? []),
      ...refsIn(`${node.title}\n${node.why}\n${node.body}`, known),
    ];
    for (const target of linked) {
      if (target === id || ancestors.has(target) || seen.has(target)) continue;
      const other = cards.get(target);
      if (!other) continue;
      seen.add(target);
      const kind = kindOf(other);
      if (kind === "stop") stops.push({ id: target, reason: other.status });
      if (kind !== "clean") continue;
      first.push(target);
      linkedCards.push(target);
    }
  }
  // A linked card comes in as first tier. Its own subtree is context.
  for (const id of linkedCards) {
    for (const child of children.get(id) ?? []) take(child, second, false);
  }

  // Every card in the scope adds each card it depends on, with that card's subtree.
  const queue = [...first, ...second];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const target of dependsOn.get(id) ?? []) {
      if (seen.has(target) || !cards.has(target)) continue;
      const before = second.length;
      take(target, second, false);
      queue.push(...second.slice(before));
    }
  }
  return { first, second, stops };
}

/** The line of the last event of the log that names each card, as the position of its latest change (#ms-store-scope). */
export function lastChanges(
  entries: readonly LogEntry[],
  ids: readonly string[],
): Record<string, number> {
  const wanted = new Set(ids);
  const last: Record<string, number> = {};
  for (const entry of entries) {
    const event = entry.event;
    if (typeof event !== "object" || event === null) continue;
    const named = event as Record<string, unknown>;
    for (const key of ["id", "from", "to"]) {
      const value = named[key];
      if (typeof value === "string" && wanted.has(value)) {
        last[value] = entry.line;
      }
    }
  }
  return last;
}
