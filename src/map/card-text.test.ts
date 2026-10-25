import { expect, test } from "bun:test";
import { renderCard, rootCardId } from "./card-text.ts";
import { fold } from "./fold.ts";

const ev = (event: unknown, line: number) => ({ line, event });
const base = { type: "node.proposed", kind: "card", status: "open" };

test("a ghost under a parent prints as proposed, and its parent lists it", () => {
  const map = fold([
    ev({ ...base, id: "p", title: "Parent" }, 1),
    ev(
      {
        ...base,
        id: "c",
        title: "#Child",
        why: "because",
        body: "details",
        parent: "p",
      },
      2,
    ),
  ]);
  const child = renderCard(map, "c") ?? "";
  expect(child).toContain("card c  [open]  proposed");
  expect(child).toContain("#Child");
  expect(child).toContain("why: because");
  expect(child).toContain("details");
  expect(child).toContain("-> refines");
  expect(renderCard(map, "p")).toContain(
    "<- refines        c  #Child  [proposed]",
  );
});

test("an unknown card has no text", () => {
  expect(renderCard(fold([]), "x")).toBeNull();
});

test("a card with notes prints a thread with each note and the marker", () => {
  const log = [
    ev({ ...base, id: "x", title: "X" }, 1),
    ev(
      { type: "note.added", id: "x", by: "you", text: "Say what it writes." },
      2,
    ),
  ];
  const text = renderCard(fold(log), "x") ?? "";
  expect(text).toContain("thread:");
  expect(text).toContain("Say what it writes.");
});

test("a card with no notes prints no thread section", () => {
  const map = fold([ev({ ...base, id: "x", title: "X" }, 1)]);
  expect(renderCard(map, "x")).not.toContain("thread:");
});

test("a card prints its waiver reasons and every form of kill criterion", () => {
  const events = [
    { ...base, id: "a", title: "A" },
    { type: "node.edited", id: "a", noBasis: "root of a tree" },
    { type: "node.edited", id: "a", unchallenged: "no real choice" },
    { type: "criterion.added", id: "a", form: "revisit" },
    { type: "criterion.added", id: "a", form: "manual", test: "use it" },
    { type: "criterion.added", id: "a", form: "no-metric", reason: "cheap" },
    {
      type: "criterion.added",
      id: "a",
      form: "metric",
      source: "posthog",
      metric: "install time",
      threshold: "> 4 min",
      window: "7 days",
      sample: "100",
    },
  ];
  const text = renderCard(fold(events.map((e, i) => ev(e, i + 1))), "a") ?? "";
  expect(text).toContain("basis waived: root of a tree");
  expect(text).toContain("option waived: no real choice");
  expect(text).toContain("kill: revisit at any time");
  expect(text).toContain("kill: manual test: use it");
  expect(text).toContain("kill: no metric: cheap");
  expect(text).toContain(
    "kill: install time > 4 min over 7 days, sample 100, from posthog",
  );
});

const fx = await import("./mark-fixtures.ts");

test("a card's rollup line counts the card and its whole refines subtree", () => {
  const map = fx.build(
    fx.decided("r"),
    fx.open("a", { parent: "r" }),
    fx.open("b", { parent: "r", status: "proto" }),
    fx.decided("g"),
    fx.link("g", "a", "refines"),
  );
  const text = renderCard(map, "r") ?? "";
  expect(text.match(/^rollup:.*$/gm)).toEqual([
    "rollup: 4 cards: 1 open, 1 proto, 2 decided",
  ]);
});

test("each incoming refines link shows the child's own rollup", () => {
  const map = fx.build(
    fx.open("p"),
    fx.open("c", { parent: "p" }),
    fx.open("g1", { parent: "c" }),
    fx.decided("g2"),
    fx.link("g2", "c", "refines"),
  );
  const text = renderCard(map, "p") ?? "";
  expect(text).toContain("rollup: 4 cards: 3 open, 0 proto, 1 decided");
  expect(text).toContain(
    "<- refines        c  Title c  (rollup: 3 cards: 2 open, 0 proto, 1 decided)",
  );
});

const quote = (extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});

test("a card prints its options, excerpts and a proposed source with their words", () => {
  const map = fx.build(
    fx.open("y"),
    fx.open("x"),
    fx.link("x", "y"),
    fx.ghost("x:opt0", { kind: "option", title: "Per call", why: "Too noisy" }),
    fx.link("x:opt0", "x", "alternative_to"),
    quote(),
    fx.ghost("x:src0", { kind: "source", title: "Survey", why: "70% agree" }),
    fx.link("x", "x:src0", "supported_by"),
  );
  const text = renderCard(map, "x") ?? "";
  const at = (s: string) => text.indexOf(s);
  expect(text).toContain("why: x takes y");
  expect(at("Options:")).toBeGreaterThan(at("-> depends_on"));
  expect(text).toContain(
    "x:opt0  Per call  proposed\n      why not: Too noisy",
  );
  expect(text).toContain("Say:\n  agent: seats are the unit");
  expect(text).toContain(
    "Ev:\n  x:src0  Survey  proposed\n      finding: 70% agree",
  );
});

test("a card with no options prints no Options section", () => {
  const map = fx.build(fx.open("x"), quote());
  const text = renderCard(map, "x") ?? "";
  expect(text).toContain("Say:");
  expect(text).not.toContain("Options:");
});

test("the root card is the first real card that refines no other", () => {
  const map = fx.build(fx.open("r"), fx.open("c", { parent: "r" }));
  expect(rootCardId(map)).toBe("r");
  expect(rootCardId(fx.build())).toBeNull();
});

test("the root card is never an unaccepted ghost", () => {
  const map = fold([ev({ ...base, id: "g", title: "Ghost" }, 1)]);
  expect(rootCardId(map)).toBeNull();
});
