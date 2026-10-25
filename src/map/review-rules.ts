/**
 * What the end of a review does to the map. See #rederive-reason, #vi-prop-amended and
 * #werk-cli-reopen. A review of a stale card ends in a confirm or an amend. A confirm
 * clears the card's stale marks and stops there. An amend clears them too, and marks the
 * next hop as stale with the review sentence as its text.
 */
import { checkDecide } from "./contract.ts";
import type { FoldedMap, Violation } from "./fold.ts";
import { basisWaiting, fixBasis, markNextHop } from "./mark-rules.ts";
import { outRefusal } from "./removal-rules.ts";

const bad = (detail: string): Violation => ({ rule: "bad-event", detail });
const refuse = (detail: string): Violation => ({ rule: "review", detail });

function applyTo(
  map: FoldedMap,
  id: string,
  amend: string | null,
  at: string,
): void {
  const node = map.nodes.get(id);
  if (!node) return;
  node.marks = node.marks.filter((mark) => mark.kind !== "stale");
  if (amend !== null) {
    markNextHop(map, id, {
      origin: id,
      reason: "amended",
      at,
      text: amend,
    });
  }
}

export function applyReview(
  map: FoldedMap,
  fields: Record<string, unknown>,
): Violation | null {
  const { id, outcome, why, confirmed, at, decide } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  if (outcome !== "confirm" && outcome !== "amend") {
    return bad('"outcome" must be confirm or amend');
  }
  if (why !== undefined && typeof why !== "string") {
    return bad('"why" must be text');
  }
  if (at !== undefined && typeof at !== "string") {
    return bad('"at" must be text');
  }
  if (
    confirmed !== undefined &&
    !(Array.isArray(confirmed) && confirmed.every((c) => typeof c === "string"))
  ) {
    return bad('"confirmed" must be a list of ids');
  }
  const node = map.nodes.get(id);
  if (!node) {
    return (
      outRefusal(map, id) ?? { rule: "unknown-card", detail: `no card "${id}"` }
    );
  }
  if (node.kind !== "card" || node.proposed) {
    return refuse(
      `"${id}" is not a card in the map, and only a card is reviewed`,
    );
  }
  if (!node.marks.some((mark) => mark.kind === "stale")) {
    return refuse(`"${id}" has no stale mark to review`);
  }
  if (outcome === "amend" && (why === undefined || why.trim() === "")) {
    return refuse(
      `an amend needs the sentence that says what changed. Fix: werk rederive ${id} --amend "<what changed>"`,
    );
  }
  if (outcome === "confirm") {
    const waiting = basisWaiting(map, node);
    if (waiting.length > 0) {
      const names = waiting
        .map((t) => `${t.id} (${t.status === "decided" ? "stale" : t.status})`)
        .join(", ");
      return refuse(
        `"${id}" cannot be confirmed while its basis is not decided and clear: ${names}. Fix: ${waiting.map(fixBasis).join(", ")}`,
      );
    }
    const named = new Set((confirmed as string[] | undefined) ?? []);
    const links = map.edges
      .filter((edge) => edge.from === id && edge.type === "depends_on")
      .map((edge) => edge.to);
    const skipped = links.filter((to) => !named.has(to));
    if (skipped.length > 0) {
      return refuse(
        `"${id}" has link reasons that no one confirmed: ${skipped.join(", ")}. Read each reason, then: werk rederive ${id} --confirm ${links.join(",")}`,
      );
    }
  }
  const amend = outcome === "amend" ? (why as string) : null;
  if (decide === true) {
    const trial = structuredClone(map);
    applyTo(trial, id, amend, at ?? "");
    const violation = checkDecide(trial, id);
    if (violation) return violation;
  }
  applyTo(map, id, amend, at ?? "");
  return null;
}
