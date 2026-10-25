import { expect, test } from "bun:test";
import { renderCard } from "./card-text.ts";
import { fold } from "./fold.ts";

const ev = (event: unknown, line: number) => ({ line, event });
const card = {
  type: "node.proposed",
  id: "x",
  kind: "card",
  title: "X",
  status: "open",
};
const quoted = {
  type: "excerpt.quoted",
  id: "x:ex0",
  title: "seats are the unit",
  card: "x",
  conversation: "pricing",
  session: "s1",
  message: 2,
  start: 0,
  end: 18,
  speaker: "agent",
  said_at: "10:02",
};
const acceptCard = { type: "node.accepted", id: "x", actor: "you" };
const accept = { type: "node.accepted", id: "x:ex0", actor: "you" };
const problems = (...events: unknown[]) =>
  fold(events.map(ev)).problems.map((p) => p.rule);

test("a quote makes a decided ghost excerpt with a held supported_by link and its pointer", () => {
  const map = fold([ev(card, 1), ev(quoted, 2)]);
  expect(map.problems).toEqual([]);
  const node = map.nodes.get("x:ex0");
  expect(node).toMatchObject({
    kind: "excerpt",
    title: "seats are the unit",
    status: "decided",
    proposed: true,
    pointer: { conversation: "pricing", message: 2, start: 0, end: 18 },
  });
  expect(map.ghostEdges).toMatchObject([
    { from: "x", to: "x:ex0", type: "supported_by" },
  ]);
  const shown = renderCard(map, "x:ex0") ?? "";
  expect(shown).toContain("seats are the unit");
  expect(shown).toContain(
    "said by agent at 10:02: conversation pricing, session s1, message 2, span 0..18",
  );
});

test("accepting the excerpt makes its link live", () => {
  const map = fold([
    ev(card, 1),
    ev(acceptCard, 2),
    ev(quoted, 3),
    ev(accept, 4),
  ]);
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("x:ex0")?.proposed).toBe(false);
  expect(map.edges).toHaveLength(1);
});

test("an event with a missing or malformed pointer part is set aside", () => {
  for (const [key, value] of [
    ["session", undefined],
    ["speaker", ""],
    ["said_at", 5],
    ["message", -1],
    ["message", 1.5],
    ["start", "0"],
    ["end", 0],
    ["conversation", "../x"],
  ] as const) {
    const event = { ...quoted, [key]: value };
    const map = fold([ev(card, 1), ev(event, 2)]);
    expect(map.problems.map((p) => p.rule)).toEqual(["bad-event"]);
    expect(map.nodes.has("x:ex0")).toBe(false);
  }
});

test("a taken name and an unknown citing card are set aside", () => {
  expect(problems(card, quoted, quoted)).toEqual(["duplicate-id"]);
  expect(problems({ ...quoted, card: "nope" })).toEqual(["unknown-card"]);
});

test("a card cannot be quoted when it is removed", () => {
  expect(
    problems(card, acceptCard, { type: "node.removed", id: "x" }, quoted),
  ).toContain("unknown-card");
});

test("a plain add of an excerpt is refused", () => {
  expect(
    problems({ ...card, id: "e", kind: "excerpt", title: "made up" }),
  ).toEqual(["excerpt"]);
});

test("a retitle or a text edit of an excerpt is refused before and after the accept", () => {
  const changes = [
    { type: "change.proposed", id: "x:ex0", title: "other words" },
    { type: "change.proposed", id: "x:ex0", why: "other" },
    { type: "node.edited", id: "x:ex0", why: "other" },
    { type: "node.edited", id: "x:ex0", body: "other" },
  ];
  for (const change of changes) {
    expect(problems(card, quoted, change)).toEqual(["excerpt"]);
    expect(problems(card, quoted, accept, change)).toEqual(["excerpt"]);
  }
});

test("a note on an excerpt works, and so does a who edit on the card", () => {
  expect(
    problems(card, quoted, accept, {
      type: "note.added",
      id: "x:ex0",
      by: "you",
      text: "checked",
    }),
  ).toEqual([]);
});
