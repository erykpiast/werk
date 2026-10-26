/** Map-log event builders. No test runner import: the browser specs use them too. */
export type Fields = Record<string, unknown>;

export const proposed = (id: string, o: Fields = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...o,
});
export const accepted = (id: string) => ({
  type: "node.accepted",
  id,
  actor: "you",
});
/** A real card: proposed, then accepted. */
export const card = (id: string, o: Fields = {}) => [
  proposed(id, o),
  accepted(id),
];
/** A real card that is decided, waiving the facts the scenario does not care about. */
export const decided = (id: string, o: Fields = {}) => [
  ...card(id, o),
  { type: "node.edited", id, who: "me", noBasis: "held-out setup" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];
export const edge = (from: string, to: string, link: string, why = "because") => ({
  type: "edge.added",
  from,
  to,
  link,
  why,
});
export const refines = (child: string, parent: string) =>
  edge(child, parent, "refines", "");
export const reopen = (id: string, o: Fields = {}) => ({
  type: "node.reopened",
  id,
  at: "2026-10-10T09:00:00.000Z",
  ...o,
});

