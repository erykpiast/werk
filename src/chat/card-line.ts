/**
 * The lines that open a turn with the card the person is looking at. A change of card carries a
 * compact description built from the map; every other turn carries a one-line reminder
 * (#werk-pane, #werk-card-blind). The whole tree is the home card's page, so a turn from it names
 * the home card (#werk-chat-no-card-line).
 */
import type { FoldedMap } from "../map/fold.ts";
import { openCardId } from "../serve/open-card.ts";

export type CardLine = {
  /** The text that goes before the person's message, or "" when the map has no card. */
  text: string;
  /** The card the agent now knows as open, to pass to the next turn. */
  announced: string | null;
};

/** The card a turn names: the open card when the map has it, else the home card. */
export function cardOfTurn(map: FoldedMap, card: string | null): string | null {
  const node = card === null ? undefined : map.nodes.get(card);
  if (node && node.kind === "card" && !node.proposed) return node.id;
  return openCardId(map);
}

function refs(map: FoldedMap, ids: string[]): string {
  return ids
    .map((id) => `#${id} — ${map.nodes.get(id)?.title ?? ""}`)
    .join("; ");
}

/** The compact block: title, why, kind, status, who, children and depends_on. */
export function describeCard(map: FoldedMap, id: string): string {
  const node = map.nodes.get(id);
  if (!node) return "";
  const children = map.edges
    .filter((e) => e.type === "refines" && e.to === id)
    .map((e) => e.from);
  const needs = map.edges
    .filter((e) => e.type === "depends_on" && e.from === id)
    .map((e) => e.to);
  const lines = [
    `[the map is now at #${id} — ${node.title}]`,
    `kind: ${node.kind}; status: ${node.status}${node.who ? `; who: ${node.who}` : ""}`,
  ];
  if (node.why !== "") lines.push(`why: ${node.why}`);
  if (children.length > 0) lines.push(`children: ${refs(map, children)}`);
  if (needs.length > 0) lines.push(`depends_on: ${refs(map, needs)}`);
  return lines.join("\n");
}

/** The opening of one turn. `announced` is the card the agent was told about last. */
export function cardLine(
  map: FoldedMap,
  card: string | null,
  announced: string | null,
): CardLine {
  const id = cardOfTurn(map, card);
  const node = id === null ? undefined : map.nodes.get(id);
  if (id === null || !node) return { text: "", announced };
  if (id === announced) {
    return { text: `[still on #${id} — ${node.title}]`, announced: id };
  }
  return { text: describeCard(map, id), announced: id };
}
