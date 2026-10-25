/**
 * The contract check: the four facts a card needs before it is decided.
 * See #werk-contract, #werk-contract-facts, #werk-contract-fix,
 * #werk-contract-all-missing, #werk-contract-no-decider and #werk-contract-waiver-reason.
 */
import type { Edge, FoldedMap, MapNode, Violation } from "./fold.ts";

/** Whether `other` may stand for `card` in a fact: a real card needs a real one, a ghost takes either. */
function counts(card: MapNode, other: MapNode): boolean {
  return card.proposed || !other.proposed;
}

function heldAndLiveEdges(map: FoldedMap): Edge[] {
  return [...map.edges, ...map.ghostEdges];
}

function whoMissing(card: MapNode): string | null {
  if (card.who !== null) return null;
  return `who: not set. Fix: werk edit ${card.id} --who you|me|prototype`;
}

function basisMissing(map: FoldedMap, card: MapNode): string | null {
  const targets: MapNode[] = [];
  const parent = map.parents.get(card.id);
  const parentNode = parent === undefined ? undefined : map.nodes.get(parent);
  if (parentNode) targets.push(parentNode);
  for (const edge of heldAndLiveEdges(map)) {
    const target = map.nodes.get(edge.to);
    if (edge.from === card.id && edge.type === "depends_on" && target) {
      targets.push(target);
    }
  }
  const usable = targets.filter((target) => counts(card, target));
  const holds = (target: MapNode) =>
    target.status === "decided" &&
    !target.marks.some((mark) => mark.kind === "stale");
  const waiting = usable.filter((target) => !holds(target));
  if (waiting.length > 0) {
    const state = (target: MapNode) =>
      target.status === "decided" ? "stale" : target.status;
    const names = waiting
      .map((target) => `${target.id} (${state(target)})`)
      .join(", ");
    const fixes = waiting
      .map((target) =>
        target.status === "decided"
          ? `werk rederive ${target.id} --status decided`
          : `werk status ${target.id} decided`,
      )
      .join(", ");
    return `basis: the card waits on ${names}. Fix: ${fixes}`;
  }
  if (card.noBasis !== null || usable.length > 0) return null;
  return `basis: no decided depends_on target or parent. Fix: werk link ${card.id} <card> --type depends_on --why "<what it takes>", or waive it: werk edit ${card.id} --no-basis "<reason>"`;
}

function optionMissing(map: FoldedMap, card: MapNode): string | null {
  if (card.who === "me" || card.who === "prototype") return null;
  if (card.unchallenged !== null) return null;
  const weighed = heldAndLiveEdges(map).some((edge) => {
    const option = map.nodes.get(edge.from);
    return (
      edge.type === "alternative_to" &&
      edge.to === card.id &&
      option?.kind === "option" &&
      counts(card, option)
    );
  });
  if (weighed) return null;
  const ghostNote = card.proposed
    ? ""
    : ` (a real card counts only a real option, so accept ${card.id}:opt0 as well)`;
  return `option: none weighed. Fix: werk add ${card.id}:opt0 --kind option --title "<the alternative>" --why "<why not>", then werk link ${card.id}:opt0 ${card.id} --type alternative_to${ghostNote}, or state that none was weighed: werk edit ${card.id} --unchallenged "<reason>"`;
}

function killMissing(card: MapNode): string | null {
  if (card.kill.length > 0) return null;
  return `kill: no criterion on record. Fix: werk kill ${card.id} --revisit (or --manual "<test>", --no-metric "<reason>", or --metric --source --threshold --window --sample)`;
}

export type FactKey = "who" | "basis" | "option" | "kill";

/** Each fact with its check, in the order of the contract. */
const FACTS: [FactKey, (map: FoldedMap, card: MapNode) => string | null][] = [
  ["who", (_map, card) => whoMissing(card)],
  ["basis", basisMissing],
  ["option", optionMissing],
  ["kill", (_map, card) => killMissing(card)],
];

/** The facts a card holds now. */
export function heldFacts(map: FoldedMap, card: MapNode): Set<FactKey> {
  return new Set(
    FACTS.filter(([, check]) => check(map, card) === null).map(([key]) => key),
  );
}

/** The missing facts of a card, in the order of the contract. Empty when the card may be decided. */
export function missingFacts(map: FoldedMap, card: MapNode): string[] {
  return FACTS.map(([, check]) => check(map, card)).filter(
    (fact): fact is string => fact !== null,
  );
}

/** The violation a move to decided breaks, or null when every fact holds. */
export function checkDecide(map: FoldedMap, id: string): Violation | null {
  const card = map.nodes.get(id);
  if (!card) return { rule: "unknown-card", detail: `no card "${id}"` };
  if (card.kind !== "card") {
    return {
      rule: "contract",
      detail: `"${id}" is ${card.kind === "option" ? "an" : "a"} ${card.kind}, and only a card is decided`,
    };
  }
  const missing = missingFacts(map, card);
  if (missing.length === 0) return null;
  return {
    rule: "contract",
    detail: `"${id}" is missing ${missing.length} ${missing.length === 1 ? "fact" : "facts"}:\n${missing.map((fact) => `  - ${fact}`).join("\n")}`,
  };
}

/**
 * Applies a change to a copy of the map and keeps it only when no decided card loses a fact
 * of `keys` that it held before (#werk-contract-amend-scope). A card that lacks a fact
 * already is not refused, so the change that adds the fact goes through.
 */
export function applyKept(
  map: FoldedMap,
  keys: readonly FactKey[],
  apply: (trial: FoldedMap) => Violation | null,
): Violation | null {
  const held = new Map<string, Set<FactKey>>();
  for (const card of map.nodes.values()) {
    if (card.kind === "card" && card.status === "decided") {
      held.set(card.id, heldFacts(map, card));
    }
  }
  const trial = structuredClone(map);
  const violation = apply(trial);
  if (violation) return violation;
  for (const [id, before] of held) {
    const card = trial.nodes.get(id);
    if (!card) continue;
    const now = heldFacts(trial, card);
    const lost = keys.filter((key) => before.has(key) && !now.has(key));
    if (lost.length > 0) {
      const fixes = missingFacts(trial, card).map((fact) => `  - ${fact}`);
      return {
        rule: "contract",
        detail: `"${id}" is decided and would lose ${lost.length === 1 ? "a fact" : "facts"} (${lost.join(", ")}):\n${fixes.join("\n")}`,
      };
    }
  }
  Object.assign(map, trial);
  return null;
}
