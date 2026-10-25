/**
 * What a proposal, an accept and a discard do to the words of a card that is in the map.
 * See #al-diff-cli, #al-diff-cli-cover and #map-frozen.
 * A proposal stays on its card until it is accepted or discarded. The latest one replaces
 * the one before. An accept on a decided card is an amend: the card stays decided, and the
 * four facts must hold on the new version (#werk-contract-amend-scope).
 */
import { checkDecide } from "./contract.ts";
import { applyOps, checkOps, type Pending, parseOps } from "./edit-diff.ts";
import type { FoldedMap, MapNode, Violation } from "./fold.ts";
import { actorRefusal } from "./ghost-rules.ts";
import { excerptFrozenDetail } from "./quote-rules.ts";
import { outRefusal } from "./removal-rules.ts";

const bad = (detail: string): Violation => ({ rule: "bad-event", detail });

/** The card a change applies to, or the refusal. A ghost's words are frozen. */
function target(map: FoldedMap, id: string): MapNode | Violation {
  const node = map.nodes.get(id);
  if (!node) {
    return (
      outRefusal(map, id) ?? { rule: "unknown-card", detail: `no card "${id}"` }
    );
  }
  if (node.kind === "excerpt") {
    return { rule: "excerpt", detail: excerptFrozenDetail(id) };
  }
  if (node.proposed) {
    return {
      rule: "frozen",
      detail: `"${id}" is a ghost and its words are frozen; discard it and propose it again`,
    };
  }
  return node;
}

function isViolation(value: MapNode | Violation): value is Violation {
  return "rule" in value;
}

/** Stages a change to the title, the why or the body of a card. */
export function proposeChange(
  map: FoldedMap,
  fields: Record<string, unknown>,
): Violation | null {
  const { id, title, why, ops } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  for (const [key, value] of [
    ["title", title],
    ["why", why],
  ] as const) {
    if (value !== undefined && typeof value !== "string") {
      return bad(`"${key}" must be text`);
    }
  }
  if (title === undefined && why === undefined && ops === undefined) {
    return bad('a proposal needs a "title", a "why" or "ops"');
  }
  const node = target(map, id);
  if (isViolation(node)) return node;
  const pending: Pending = {};
  if (typeof title === "string") pending.title = title;
  if (typeof why === "string") pending.why = why;
  if (ops !== undefined) {
    const parsed = parseOps(ops);
    if (typeof parsed === "string") return bad(parsed);
    const checked = checkOps(node.body, parsed);
    if (!checked.ok) {
      return {
        rule: "cover",
        detail: `"${id}" has ${checked.atRisk.length === 1 ? "a block" : "blocks"} that no op names, and would lose ${checked.atRisk.length === 1 ? "it" : "them"} on accept. Name each as the old of an elaborated op (to keep it, with old and new equal) or of a removed op:\n${checked.atRisk.map((block) => `  - ${JSON.stringify(block)}`).join("\n")}`,
      };
    }
    pending.ops = checked.ops;
  }
  node.pending = pending;
  return null;
}

function withPending(
  map: FoldedMap,
  id: string,
): { node: MapNode; pending: Pending } | Violation {
  const node = target(map, id);
  if (isViolation(node)) return node;
  if (node.pending === null) {
    return {
      rule: "not-ghost",
      detail: `"${id}" is already in the map and has no pending change`,
    };
  }
  return { node, pending: node.pending };
}

/** Commits the pending change. On a decided card it is an amend, and it waits for a missing fact. */
export function acceptChange(
  map: FoldedMap,
  id: string,
  actor: unknown,
): Violation | null {
  const unasked = actorRefusal(actor);
  if (unasked) return unasked;
  const found = withPending(map, id);
  if ("rule" in found) return found;
  const { node, pending } = found;
  if (node.status === "decided") {
    const violation = checkDecide(map, id);
    if (violation) return violation;
  }
  if (pending.title !== undefined) node.title = pending.title;
  if (pending.why !== undefined) node.why = pending.why;
  if (pending.ops !== undefined) {
    node.body = applyOps(pending.ops);
  }
  node.pending = null;
  return null;
}

/** Drops the pending change and leaves the card as it is. */
export function discardChange(map: FoldedMap, id: string): Violation | null {
  const found = withPending(map, id);
  if ("rule" in found) return found;
  found.node.pending = null;
  return null;
}
