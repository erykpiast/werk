/**
 * What a reopen does to the map. See #pr-wf-paused, #pr-wf-postponed, #pr-wf-paused-reach
 * and #werk-cli-reopen. A reopen takes a decided card, or a postponed one, back to open and
 * marks the cards that depend on it by its reason.
 */
import {
  type FoldedMap,
  REOPEN_REASONS,
  type ReopenReason,
  type Violation,
} from "./fold.ts";
import {
  clearResumed,
  markDownstream,
  markNextHop,
  markPostponed,
} from "./mark-rules.ts";
import { outRefusal } from "./removal-rules.ts";

const bad = (detail: string): Violation => ({ rule: "bad-event", detail });

export function applyReopen(
  map: FoldedMap,
  fields: Record<string, unknown>,
): Violation | null {
  const { id, reason, why, at } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  if (why !== undefined && typeof why !== "string") {
    return bad('"why" must be text');
  }
  if (at !== undefined && typeof at !== "string") {
    return bad('"at" must be text');
  }
  const named = reason ?? "invalidated";
  if (!(REOPEN_REASONS as readonly unknown[]).includes(named)) {
    return bad(`"reason" must be one of ${REOPEN_REASONS.join(", ")}`);
  }
  const node = map.nodes.get(id);
  if (!node) {
    return (
      outRefusal(map, id) ?? { rule: "unknown-card", detail: `no card "${id}"` }
    );
  }
  const postponed = node.marks.some((mark) => mark.kind === "postponed");
  if (node.kind !== "card" || node.proposed) {
    return {
      rule: "reopen",
      detail: `"${id}" is not a card in the map, and only a card is reopened`,
    };
  }
  if (node.status !== "decided" && !postponed) {
    return {
      rule: "reopen",
      detail: `"${id}" is not decided, so it has nothing to reopen`,
    };
  }
  const cause = {
    origin: id,
    reason: named as ReopenReason,
    at: at ?? "",
    text: why ?? "",
  };
  // A later reopen ends the earlier postponement, with the marks it put downstream.
  clearResumed(map, id);
  node.status = "open";
  if (cause.reason === "postponed") {
    markPostponed(node, cause);
    markDownstream(map, id, cause);
  } else {
    markNextHop(map, id, cause);
  }
  return null;
}
