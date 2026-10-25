import { describe, expect, test } from "bun:test";
import { applyEvent, type FoldedMap, fold, type LogEntry } from "./fold.ts";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
const option = (id: string) => ({
  type: "node.proposed",
  id,
  kind: "option",
  title: id,
  status: "open",
});
const alt = (from: string, to: string) => ({
  type: "edge.added",
  from,
  to,
  link: "alternative_to",
});
const accept = (id: string, actor = "you") => ({
  type: "node.accepted",
  id,
  actor,
});
const discard = (id: string) => ({ type: "node.discarded", id });
const propose = (id: string, fields: Record<string, unknown>) => ({
  type: "change.proposed",
  id,
  ...fields,
});
const keep = (old: string) => ({ tag: "elaborated", old, new: old });
const build = (...events: unknown[]): FoldedMap =>
  fold(events.map((event, i): LogEntry => ({ line: i + 1, event })));
const rules = (map: FoldedMap) => map.problems.map((p) => p.rule);

/** A real card with a two-block body, decided with who me, so it needs no option. */
const decidedMe = (id = "q") => [
  card(id, { body: "One.\n\nTwo." }),
  accept(id),
  { type: "node.edited", id, who: "me", noBasis: "root" },
  { type: "criterion.added", id, form: "revisit" },
  { type: "node.decided", id },
];

describe("propose", () => {
  test("a proposal that leaves a block unnamed is refused and prints the block", () => {
    const map = build(...decidedMe(), propose("q", { ops: [keep("One.")] }));
    expect(rules(map)).toEqual(["cover"]);
    expect(map.problems[0]?.detail).toContain('"Two."');
    expect(map.nodes.get("q")?.pending).toBeNull();
  });

  test("the pending change is the latest proposal, and it leaves the words as they are", () => {
    const map = build(
      ...decidedMe(),
      propose("q", { title: "First" }),
      propose("q", { why: "Second" }),
    );
    const node = map.nodes.get("q");
    expect(node?.pending).toEqual({ why: "Second" });
    expect(node?.title).toBe("Title q");
  });

  test("a bad proposal is named: no change, wrong types, bad ops, unknown, ghost", () => {
    const only = (event: unknown) =>
      rules(build(card("a"), accept("a"), event));
    expect(only(propose("a", {}))).toEqual(["bad-event"]);
    expect(only(propose("a", { title: 3 }))).toEqual(["bad-event"]);
    expect(only(propose("a", { ops: "x" }))).toEqual(["bad-event"]);
    expect(only({ type: "change.proposed" })).toEqual(["bad-event"]);
    expect(only(propose("zz", { title: "t" }))).toEqual(["unknown-card"]);
    expect(rules(build(card("g"), propose("g", { title: "t" })))).toEqual([
      "frozen",
    ]);
  });

  test("a removed card takes no proposal", () => {
    const map = build(
      card("a"),
      accept("a"),
      { type: "node.removed", id: "a" },
      propose("a", { title: "t" }),
    );
    expect(rules(map)).toEqual(["unknown-card"]);
  });
});

describe("accept and discard of a change", () => {
  test("accepting an edit to a decided card leaves it decided with the new body", () => {
    const map = build(
      ...decidedMe(),
      propose("q", {
        title: "New title",
        ops: [
          keep("One."),
          { tag: "elaborated", old: "Two.", new: "Two, more." },
        ],
      }),
      accept("q"),
    );
    expect(map.problems).toEqual([]);
    const node = map.nodes.get("q");
    expect(node?.status).toBe("decided");
    expect(node?.body).toBe("One.\n\nTwo, more.");
    expect(node?.title).toBe("New title");
    expect(node?.pending).toBeNull();
  });

  test("an accept needs the person's statement and a pending change", () => {
    const base = [...decidedMe(), propose("q", { why: "w" })];
    expect(rules(build(...base, accept("q", "me")))).toEqual(["accept-actor"]);
    expect(rules(build(...base, accept("q"), accept("q")))).toEqual([
      "not-ghost",
    ]);
  });

  test("a discard drops the pending change and leaves the card as it was", () => {
    const map = build(...decidedMe(), propose("q", { why: "w" }), discard("q"));
    expect(map.nodes.get("q")?.pending).toBeNull();
    expect(map.nodes.get("q")?.why).toBe("");
    expect(rules(build(...decidedMe(), discard("q")))).toEqual(["not-ghost"]);
  });

  test("an open card changes through a proposal and stays open", () => {
    const map = build(
      card("o", { body: "X." }),
      accept("o"),
      propose("o", {
        ops: [
          { tag: "removed", old: "X." },
          { tag: "new", new: "Y." },
        ],
      }),
      accept("o"),
    );
    expect(map.problems).toEqual([]);
    expect(map.nodes.get("o")?.status).toBe("open");
    expect(map.nodes.get("o")?.body).toBe("Y.");
  });

  test("a card decided with no kill criterion refuses a body edit and takes a new criterion", () => {
    const map = build(...decidedMe());
    const legacy = map.nodes.get("q");
    if (!legacy) throw new Error("no card");
    legacy.kill = [];
    expect(
      applyEvent(map, propose("q", { ops: [keep("One."), keep("Two.")] })),
    ).toBeNull();
    const refused = applyEvent(map, accept("q"));
    expect(refused?.rule).toBe("contract");
    expect(refused?.detail).toContain("kill:");
    expect(legacy.pending).not.toBeNull();
    expect(
      applyEvent(map, { type: "criterion.added", id: "q", form: "revisit" }),
    ).toBeNull();
    expect(applyEvent(map, accept("q"))).toBeNull();
  });
});

describe("a decided card keeps the facts it had", () => {
  const decidedYou = [
    card("q"),
    accept("q"),
    { type: "node.edited", id: "q", who: "you", noBasis: "root" },
    option("q:o1"),
    alt("q:o1", "q"),
    accept("q:o1"),
    { type: "criterion.added", id: "q", form: "revisit" },
    { type: "node.decided", id: "q" },
  ];

  test("removing the last option is refused; adding a second and then removing the first works", () => {
    const refused = build(...decidedYou, { type: "node.removed", id: "q:o1" });
    expect(rules(refused)).toEqual(["contract"]);
    expect(refused.nodes.has("q:o1")).toBe(true);
    const swapped = build(
      ...decidedYou,
      option("q:o2"),
      alt("q:o2", "q"),
      accept("q:o2"),
      { type: "node.removed", id: "q:o1" },
    );
    expect(swapped.problems).toEqual([]);
    expect(swapped.nodes.has("q:o1")).toBe(false);
    expect(swapped.nodes.has("q:o2")).toBe(true);
  });

  test("removing a card that another card depends on is not refused", () => {
    const map = build(
      card("t"),
      accept("t"),
      { type: "node.edited", id: "t", who: "me", noBasis: "root" },
      { type: "criterion.added", id: "t", form: "revisit" },
      { type: "node.decided", id: "t" },
      card("d"),
      accept("d"),
      { type: "node.edited", id: "d", who: "me" },
      {
        type: "edge.added",
        from: "d",
        to: "t",
        link: "depends_on",
        why: "takes it",
      },
      { type: "criterion.added", id: "d", form: "revisit" },
      { type: "node.decided", id: "d" },
      { type: "node.removed", id: "t" },
    );
    expect(map.problems).toEqual([]);
  });

  test("a change of who or a waiver that adds a fact is allowed, and one that drops a fact is not", () => {
    const toMe = build(...decidedYou, {
      type: "node.edited",
      id: "q",
      who: "me",
    });
    expect(toMe.problems).toEqual([]);
    const toYou = build(...decidedMe(), {
      type: "node.edited",
      id: "q",
      who: "you",
    });
    expect(rules(toYou)).toEqual(["contract"]);
    expect(toYou.nodes.get("q")?.who).toBe("me");
  });
});
