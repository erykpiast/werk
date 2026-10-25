/** Events and a builder for the tests of the mark rules. */
import { type FoldedMap, fold, type LogEntry } from "./fold.ts";

export const AT = "2026-10-10T09:00:00.000Z";

/** The events that make a card and decide it, waiving the facts the test does not care about. */
export function decided(id: string, extra: Record<string, unknown> = {}) {
  return [
    ...open(id, extra),
    { type: "node.edited", id, who: "me", noBasis: "test" },
    { type: "criterion.added", id, form: "revisit" },
    { type: "node.decided", id },
  ];
}

export const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});

/** A real open card: proposed, then accepted. */
export const open = (id: string, extra: Record<string, unknown> = {}) => [
  ghost(id, extra),
  { type: "node.accepted", id, actor: "you" },
];

export const link = (from: string, to: string, type = "depends_on") => ({
  type: "edge.added",
  from,
  to,
  link: type,
  why: `${from} takes ${to}`,
});

export const reopen = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.reopened",
  id,
  at: AT,
  ...extra,
});

export const review = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.reviewed",
  id,
  outcome: "confirm",
  at: AT,
  ...extra,
});

export const decide = (id: string) => ({ type: "node.decided", id });

export function build(...events: unknown[]): FoldedMap {
  return fold(
    events.flat().map((event, i): LogEntry => ({ line: i + 1, event })),
  );
}

export const kinds = (map: FoldedMap, id: string) =>
  (map.nodes.get(id)?.marks ?? []).map((mark) => mark.kind);
export const rules = (map: FoldedMap) =>
  map.problems.map((problem) => problem.rule);
