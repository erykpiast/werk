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
  if (card.noBasis !== null) return null;
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
  if (usable.some(holds)) return null;
  const waiver = `or waive it: werk edit ${card.id} --no-basis "<reason>"`;
  if (usable.length === 0) {
    return `basis: no decided depends_on target or parent. Fix: werk link ${card.id} <card> --type depends_on --why "<what it takes>", ${waiver}`;
  }
  const state = (target: MapNode) =>
    target.status === "decided" ? "stale" : target.status;
  const names = usable
    .map((target) => `${target.id} (${state(target)})`)
    .join(", ");
  return `basis: the card waits on ${names}. Fix: decide the open basis again, ${waiver}`;
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
  return `option: none weighed. Fix: werk add ${card.id}:opt0 --kind option --title "<the alternative>" --why "<why not>", then werk link ${card.id}:opt0 ${card.id} --type alternative_to, or state that none was weighed: werk edit ${card.id} --unchallenged "<reason>"`;
}

function killMissing(card: MapNode): string | null {
  if (card.kill.length > 0) return null;
  return `kill: no criterion on record. Fix: werk kill ${card.id} --revisit (or --manual "<test>", --no-metric "<reason>", or --metric --source --threshold --window --sample)`;
}

/** The missing facts of a card, in the order of the contract. Empty when the card may be decided. */
export function missingFacts(map: FoldedMap, card: MapNode): string[] {
  return [
    whoMissing(card),
    basisMissing(map, card),
    optionMissing(map, card),
    killMissing(card),
  ].filter((fact): fact is string => fact !== null);
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
