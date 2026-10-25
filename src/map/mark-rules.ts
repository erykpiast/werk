/**
 * Derives the marks on cards from the order of events. See #vi-prop, #pr-wf-paused,
 * #pr-wf-paused-reach, #vi-prop-bornstale, #vi-prop-trace-reason and #pr-wf-paused-resume.
 * A change walks the links that exist when it happens. A link made later is not in the walk,
 * so it carries no mark from that change.
 */
import type { Edge, FoldedMap, MapNode, Mark } from "./fold.ts";

type Origin = Pick<Mark, "origin" | "reason" | "at" | "text">;

function day(at: string): string {
  return at.slice(0, 10);
}

function linkLine(link: Edge): string {
  return `${link.from} -> ${link.to}${link.why === "" ? "" : `: ${link.why}`}`;
}

/** The printed trace of a mark: its cause, its text, the path, and the last link (#vi-prop-trace). */
export function traceText(mark: Omit<Mark, "trace">): string {
  const when = mark.at === "" ? "" : ` on ${day(mark.at)}`;
  if (mark.kind === "postponed") {
    return [
      `POSTPONED${when}`,
      ...(mark.text === "" ? [] : [`  ${mark.text}`]),
    ].join("\n");
  }
  const head = `${mark.kind.toUpperCase()} from #${mark.origin}, ${mark.reason}${when}`;
  const lines = [head];
  if (mark.text !== "") lines.push(`  ${mark.text}`);
  if (mark.kind === "paused" && mark.via.length > 0) {
    lines.push(
      `  via ${mark.via.join(", ")} (nearest to ${mark.origin} first)`,
    );
  }
  if (mark.link) lines.push(`  ${linkLine(mark.link)}`);
  if (mark.kind === "paused" && mark.link) {
    lines.push(`  last hop: ${mark.link.type}`);
  }
  return lines.join("\n");
}

/**
 * Puts a mark on a card. A paused and a stale mark sit side by side, so a review that clears the
 * stale one leaves the pause (#vi-prop-review-clears-stale). Stale wins only where the kind is
 * shown (#pr-wf-paused).
 */
function addMark(node: MapNode, mark: Omit<Mark, "trace">): void {
  node.marks = node.marks.filter(
    (m) => !(m.kind === mark.kind && m.origin === mark.origin),
  );
  node.marks.push({ ...mark, trace: traceText(mark) });
}

/** The links that carry a change into a card: its direct children and its direct dependents. */
function incoming(map: FoldedMap, id: string): Edge[] {
  return map.edges.filter(
    (edge) =>
      edge.to === id && (edge.type === "refines" || edge.type === "depends_on"),
  );
}

/** Marks the direct dependents and direct children of a card as stale. A mark never goes further. */
export function markNextHop(map: FoldedMap, id: string, cause: Origin): void {
  for (const edge of incoming(map, id)) {
    const node = map.nodes.get(edge.from);
    if (node) {
      addMark(node, { kind: "stale", ...cause, link: edge, via: [] });
    }
  }
}

/** Marks every card downstream of a postponed card as paused, at any distance. */
export function markDownstream(
  map: FoldedMap,
  id: string,
  cause: Origin,
): void {
  const via = new Map<string, string[]>([[id, []]]);
  const queue = [id];
  for (const current of queue) {
    const between = via.get(current) as string[];
    for (const edge of incoming(map, current)) {
      if (via.has(edge.from)) continue;
      const path = current === id ? [] : [...between, current];
      via.set(edge.from, path);
      queue.push(edge.from);
      const node = map.nodes.get(edge.from);
      if (node)
        addMark(node, { kind: "paused", ...cause, link: edge, via: path });
    }
  }
}

/** Puts the postponed mark on the card that was postponed. */
export function markPostponed(node: MapNode, cause: Origin): void {
  addMark(node, { kind: "postponed", ...cause, link: null, via: [] });
}

/** Ends a postponement: the card's own mark goes, and so does every paused mark it caused. */
export function clearResumed(map: FoldedMap, id: string): void {
  const own = map.nodes.get(id);
  if (own) own.marks = own.marks.filter((m) => m.kind !== "postponed");
  for (const node of map.nodes.values()) {
    node.marks = node.marks.filter(
      (m) => !(m.kind === "paused" && m.origin === id),
    );
  }
}

/** The cards that a card stands on: its parent and its depends_on targets, as real cards. */
export function basisOf(map: FoldedMap, card: MapNode): MapNode[] {
  const ids = [map.parents.get(card.id)];
  for (const edge of map.edges) {
    if (edge.from === card.id && edge.type === "depends_on") ids.push(edge.to);
  }
  return ids
    .map((id) => (id === undefined ? undefined : map.nodes.get(id)))
    .filter((node): node is MapNode => node !== undefined && !node.proposed);
}

/** Whether a card holds as a basis: decided and not stale. A paused mark does not fail it (#pr-wf-paused-basis). */
export function holds(card: MapNode): boolean {
  return (
    card.status === "decided" && !card.marks.some((m) => m.kind === "stale")
  );
}

/** The basis cards that do not hold. A card with any of them waits (#map-wait). */
export function basisWaiting(map: FoldedMap, card: MapNode): MapNode[] {
  return basisOf(map, card).filter((target) => !holds(target));
}

/** The command that makes a basis hold again. */
export function fixBasis(target: MapNode): string {
  return target.status === "decided"
    ? `werk rederive ${target.id} --status decided`
    : `werk status ${target.id} decided`;
}
