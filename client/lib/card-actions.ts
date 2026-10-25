/**
 * The two buttons of a card: ✓ accepts its proposal and ✕ removes it. Each asks the server to
 * append an event, and the page redraws from the log when the live channel says it changed
 * (#werk-write, #al-diff-cli-btn, #vi-remove-btn).
 */
import { apiOf } from "./project-route";

export type RemoveFacts = {
  /** The cards that leave the map with the whole subtree, the card itself included. */
  cards: number;
  /** The direct children of the card. */
  children: number;
  /** The parent that the children would move to, or null for a root. */
  parent: { id: string; title: string } | null;
};

export type RemoveChoice = { label: string; reparent: boolean };

export type RemoveQuestion = { text: string; choices: RemoveChoice[] };

const count = (n: number, noun: string) =>
  `${n} ${n === 1 ? noun : noun === "child" ? "children" : `${noun}s`}`;

/** The facts that the ✕ carries as data attributes. */
export function removeFactsOf(data: DOMStringMap): RemoveFacts {
  const parentId = data.parent;
  return {
    cards: Number(data.cards ?? "1"),
    children: Number(data.children ?? "0"),
    parent:
      parentId === undefined
        ? null
        : { id: parentId, title: data.parentTitle ?? parentId },
  };
}

/**
 * The one confirmation. A card with no children gets a plain question that names how many cards go.
 * A card with children also offers to move them up to its parent, with both counts (#vi-remove-btn-reparent).
 */
export function removeQuestion(facts: RemoveFacts): RemoveQuestion {
  if (facts.children === 0) {
    return {
      text: `Remove this card? ${count(facts.cards, "card")} leaves the map.`,
      choices: [
        { label: `Remove ${count(facts.cards, "card")}`, reparent: false },
      ],
    };
  }
  const choices: RemoveChoice[] = [
    {
      label: `Remove the card and its subtree: ${count(facts.cards, "card")} leave the map`,
      reparent: false,
    },
  ];
  if (facts.parent) {
    choices.push({
      label: `Remove only this card: 1 card leaves the map, ${count(facts.children, "child")} move up to "${facts.parent.title}"`,
      reparent: true,
    });
  }
  return {
    text: `This card has ${count(facts.children, "child")}. What goes?`,
    choices,
  };
}

export type ActionDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  token: string;
};

/** Sends one action. Returns null when the server did it, else the reason that it refused. */
export async function sendCardAction(
  deps: ActionDeps,
  project: string,
  action: "accept" | "remove",
  body: { card: string; reparent?: boolean },
): Promise<string | null> {
  const res = await deps.fetch(apiOf(project, `/${action}`), {
    method: "POST",
    headers: {
      "x-werk-token": deps.token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const refusal = (await res.json().catch(() => ({}))) as { message?: string };
  return refusal.message ?? `The server refused: ${res.status}`;
}
