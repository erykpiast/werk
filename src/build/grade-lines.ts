/**
 * The lines a grader scores for one ticket: a delivery line per acceptance criterion, a contradiction
 * line per decided card in the depends_on closure of the cited cards, and one scope line
 * (#lp-prod-judge, #lp-prod-judge-scope). Pure.
 */
import type { FoldedMap } from "../map/fold.ts";
import { sectionOf, type Ticket } from "../tickets/ticket-parse.ts";

export type LineKind = "delivery" | "contradiction" | "scope";

export type LineSpec = {
  /** The name the grader gives the line in its reply. */
  id: string;
  kind: LineKind;
  /** The criterion, the card title, or the scope question. */
  text: string;
  /** The card of a contradiction line. */
  card?: string;
};

export const SCOPE_LINE = "scope";

const BULLET = /^\s*-\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/;

/** The acceptance criteria of a ticket, one per bullet. */
export function criteriaOf(ticket: Ticket): string[] {
  return (sectionOf(ticket, "Acceptance criteria")?.body ?? [])
    .map((line) => BULLET.exec(line.text)?.[1])
    .filter((text): text is string => text !== undefined);
}

/**
 * The decided cards a ticket rests on: each cited card and each card that one of them depends on,
 * directly or through others. A proposed card and a card that is not decided are left out.
 */
export function closureOf(map: FoldedMap, cites: readonly string[]): string[] {
  const dependsOn = new Map<string, string[]>();
  for (const edge of map.edges) {
    if (edge.type !== "depends_on") continue;
    dependsOn.set(edge.from, [...(dependsOn.get(edge.from) ?? []), edge.to]);
  }
  const found: string[] = [];
  const queue = [...cites];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (found.includes(id)) continue;
    const node = map.nodes.get(id);
    if (node === undefined || node.kind !== "card") continue;
    if (node.proposed || node.status !== "decided") continue;
    found.push(id);
    queue.push(...(dependsOn.get(id) ?? []));
  }
  return found;
}

export function lineSpecs(
  criteria: readonly string[],
  cards: readonly { id: string; title: string }[],
): LineSpec[] {
  return [
    ...criteria.map(
      (text, i): LineSpec => ({
        id: `criterion-${i + 1}`,
        kind: "delivery",
        text,
      }),
    ),
    ...cards.map(
      (card): LineSpec => ({
        id: `card-${card.id}`,
        kind: "contradiction",
        text: card.title,
        card: card.id,
      }),
    ),
    {
      id: SCOPE_LINE,
      kind: "scope",
      text: "Does the diff build a behaviour that no acceptance criterion and no story of the ticket asks for?",
    },
  ];
}
