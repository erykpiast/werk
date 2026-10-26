// The contract check (#werk-contract): the four facts a card needs before it is decided
// (#werk-contract-facts), and the rule that a change to a decided card cannot leave one missing
// (#werk-contract-amend-scope). It reads only the folded map, with the links a ghost holds, so a
// ghost can be decided before its accept (#werk-cli-decide, #pr-log-fold-marks).
import { linksFrom, linksTo, parentOf } from "./tree.ts";
import type { Event, FoldedMap } from "./types.ts";

export type Fact = "who" | "basis" | "option" | "kill criterion";

/** A fact that does not hold on a card: what is wrong, and the commands that fix it (#werk-contract-fix). */
export type Gap = { fact: Fact; problem: string; fixes: string[] };

/** The cards a card stands on: its parent, then its depends_on targets. */
function basisOf(map: FoldedMap, id: string): string[] {
  const parent = parentOf(map, id);
  const targets = linksFrom(map, id, "depends_on").map((link) => link.to);
  return parent === undefined ? targets : [parent, ...targets];
}

/** The first `<id>:optN` the map does not hold yet. */
function freeOptionId(map: FoldedMap, id: string): string {
  let n = 0;
  while (map.nodes.has(`${id}:opt${n}`)) n++;
  return `${id}:opt${n}`;
}

function whoGap(map: FoldedMap, id: string): Gap | undefined {
  if (map.nodes.get(id)?.who !== undefined) return undefined;
  return {
    fact: "who",
    problem: `no one is named to decide #${id}`,
    fixes: [`werk edit ${id} --who you|me|prototype`],
  };
}

function basisGap(map: FoldedMap, id: string): Gap | undefined {
  // A card on an open basis waits until that basis is decided (#map-wait).
  const basis = basisOf(map, id);
  const open = basis.filter((each) => map.nodes.get(each)?.status !== "decided");
  if (open.length > 0) {
    const named = open.map((each) => `#${each} is ${map.nodes.get(each)?.status ?? "missing"}`).join(", ");
    return {
      fact: "basis",
      problem: `#${id} waits on its basis: ${named}`,
      fixes: open.map((each) => `werk status ${each} decided`),
    };
  }
  if (basis.length > 0 || map.nodes.get(id)?.no_basis !== undefined) return undefined;
  return {
    fact: "basis",
    problem: `no decided card is a basis of #${id}`,
    fixes: [
      `werk link ${id} <card> --type depends_on --why "<what ${id} takes from <card>>"`,
      `or: werk edit ${id} --no-basis "<why no decided card is a basis of ${id}>"`,
    ],
  };
}

function optionGap(map: FoldedMap, id: string): Gap | undefined {
  // A card with no who needs an option too, so a bare card is refused once (#werk-contract-no-decider).
  const node = map.nodes.get(id);
  if (node?.who === "me" || node?.who === "prototype") return undefined;
  if (linksTo(map, id, "alternative_to").length > 0 || node?.unchallenged !== undefined) return undefined;
  const option = freeOptionId(map, id);
  return {
    fact: "option",
    problem: `no option was weighed against #${id}, and its who is ${node?.who ?? "not set"}`,
    fixes: [
      `werk add ${option} --kind option --title "<the option>" --why_not "<why it lost>"`,
      `then: werk link ${option} ${id} --type alternative_to`,
      `or: werk edit ${id} --unchallenged "<why no option was weighed against ${id}>"`,
    ],
  };
}

function killGap(map: FoldedMap, id: string): Gap | undefined {
  if ((map.nodes.get(id)?.kill?.length ?? 0) > 0) return undefined;
  return {
    fact: "kill criterion",
    problem: `no kill criterion is on record for #${id}`,
    fixes: [
      `werk kill ${id} --metric "<metric>" --source "<source>" --threshold "<threshold>" --window "<window>"`,
      `or: werk kill ${id} --manual "<the test you run>"`,
      `or: werk kill ${id} --no-metric "<why no metric applies>"`,
      `or: werk kill ${id} --revisit`,
    ],
  };
}

/** Every fact card `id` misses, in the order of #werk-contract-facts. Empty when it may be decided. */
export function gaps(map: FoldedMap, id: string): Gap[] {
  return [whoGap, basisGap, optionGap, killGap].flatMap((test) => test(map, id) ?? []);
}

function formatGaps(head: string, list: Gap[]): string {
  const lines = [head];
  for (const gap of list) lines.push(`  ${gap.fact}: ${gap.problem}`, ...gap.fixes.map((fix) => `    ${fix}`));
  return lines.join("\n");
}

const count = (n: number) => (n === 1 ? "1 fact is missing" : `${n} facts are missing`);

/** How an event changes a card: a decide, a change to its frozen fields (#map-frozen), or any other change. */
type Change = "decide" | "frozen" | "other";

const FROZEN_LINKS = ["refines", "depends_on"];

/** The cards each event changes. A change to another card, such as the removal of its basis, is not one. */
function changes(before: FoldedMap, events: Event[]): Map<string, Change> {
  const out = new Map<string, Change>();
  const mark = (id: string, change: Change) => {
    const was = out.get(id);
    if (was === undefined || was === "other") out.set(id, change);
  };
  for (const event of events) {
    switch (event.type) {
      case "node.decided":
        mark(event.payload.id, "decide");
        break;
      case "node.retitled":
      case "node.bodyEdited":
        mark(event.payload.id, "frozen");
        break;
      case "change.accepted":
        // An accept of a real card's pending change changes its words. On a decided card that is an
        // amend, which runs the decide facts on the new version (#map-frozen).
        if (before.nodes.get(event.payload.id)?.pending !== undefined) mark(event.payload.id, "frozen");
        break;
      case "node.edited":
      case "kill.added":
        mark(event.payload.id, "other");
        break;
      case "edge.added":
      case "edge.removed": {
        const { from, to, type } = event.payload;
        if (type === "alternative_to") mark(to, "other");
        else mark(from, FROZEN_LINKS.includes(type) ? "frozen" : "other");
        break;
      }
      case "change.discarded":
        // A discarded option is an option its card no longer has.
        for (const link of linksFrom(before, event.payload.id, "alternative_to")) mark(link.to, "other");
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * The refusal of a write that takes the map from `before` to `after` through `events`, or undefined.
 * A decide, and a change to a frozen field of a decided card, need every fact after the write. Any
 * other change to a decided card is refused only when it removes a fact the card had, so a missing
 * fact can always be added (#werk-contract-amend-scope).
 */
export function contractRefusal(before: FoldedMap, after: FoldedMap, events: Event[]): string | undefined {
  for (const [id, change] of changes(before, events)) {
    if (after.nodes.get(id)?.status !== "decided") continue;
    const now = gaps(after, id);
    if (change === "decide" && now.length > 0) return formatGaps(`#${id} cannot be decided: ${count(now.length)}`, now);
    if (change === "frozen" && now.length > 0)
      return formatGaps(`#${id} is decided, and after this change ${count(now.length)}`, now);
    const had = new Set(gaps(before, id).map((gap) => gap.fact));
    const lost = now.filter((gap) => !had.has(gap.fact));
    if (change === "other" && lost.length > 0)
      return formatGaps(`#${id} is decided, and this change removes a fact it has`, lost);
  }
  return undefined;
}
