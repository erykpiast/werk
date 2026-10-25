import { describe, expect, test } from "bun:test";
import type { RuleName } from "./fold.ts";
import {
  build,
  decide,
  decided,
  kinds,
  link,
  open,
  reopen,
  rules,
} from "./mark-fixtures.ts";

const per = (...extra: unknown[]) =>
  build(
    decided("x"),
    decided("y"),
    decided("z"),
    link("y", "x"),
    link("z", "y"),
    ...extra,
  );

describe("a reopen with no reason", () => {
  test("marks the direct dependent stale and leaves the next one clear", () => {
    const map = per(reopen("x", { why: "Charging moves to usage." }));
    expect(map.nodes.get("x")?.status).toBe("open");
    expect(kinds(map, "y")).toEqual(["stale"]);
    expect(kinds(map, "z")).toEqual([]);
    const mark = map.nodes.get("y")?.marks[0];
    expect(mark?.reason).toBe("invalidated");
    expect(mark?.trace).toBe(
      "STALE from #x, invalidated on 2026-10-10\n  Charging moves to usage.\n  y -> x: y takes x",
    );
  });

  test("marks the direct children stale", () => {
    const map = build(
      decided("x"),
      decided("c", { parent: "x" }),
      reopen("x", { reason: "rejected" }),
    );
    expect(map.nodes.get("c")?.marks[0]?.reason).toBe("rejected");
  });
});

describe("a postponement", () => {
  const p = (...extra: unknown[]) =>
    build(
      decided("p"),
      decided("q"),
      decided("r"),
      decided("s"),
      link("q", "p"),
      link("r", "q", "refines"),
      link("s", "r"),
      reopen("p", { reason: "postponed", why: "later" }),
      ...extra,
    );

  test("pauses a card three hops down and its trace names the two between", () => {
    const map = p();
    expect(kinds(map, "p")).toEqual(["postponed"]);
    expect(kinds(map, "q")).toEqual(["paused"]);
    expect(map.nodes.get("s")?.marks[0]?.via).toEqual(["q", "r"]);
    expect(map.nodes.get("s")?.marks[0]?.trace).toContain(
      "via q, r (nearest to p first)",
    );
  });

  test("leaves a card linked afterward unmarked", () => {
    const map = p(decided("n"), link("n", "r"));
    expect(kinds(map, "n")).toEqual([]);
    expect(map.nodes.get("r")?.status).toBe("decided");
  });

  test("a later reopen with another reason ends the postponement", () => {
    const map = p(reopen("p", { reason: "invalidated" }));
    expect(kinds(map, "p")).toEqual([]);
    expect(kinds(map, "q")).toEqual(["stale"]);
    expect(kinds(map, "r")).toEqual([]);
  });

  test("deciding the card again clears the paused marks it caused", () => {
    const map = p(decide("p"));
    expect(["p", "q", "r", "s"].map((id) => kinds(map, id))).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });

  test("a card basis on the postponed card waits, a paused basis holds", () => {
    const map = p();
    expect(map.nodes.get("p")?.status).toBe("open");
    const onPaused = build(
      decided("p"),
      decided("q"),
      link("q", "p"),
      reopen("p", { reason: "postponed" }),
      open("n"),
      { type: "node.edited", id: "n", who: "me", noBasis: "t" },
      { type: "criterion.added", id: "n", form: "revisit" },
      link("n", "q"),
      decide("n"),
    );
    expect(rules(onPaused)).toEqual([]);
    expect(onPaused.nodes.get("n")?.status).toBe("decided");
  });
});

describe("a reopen is refused", () => {
  test.each<[string, unknown, RuleName]>([
    ["an unknown reason", reopen("x", { reason: "later" }), "bad-event"],
    ["a reason that is not text", reopen("x", { reason: 3 }), "bad-event"],
    ["a text that is not text", reopen("x", { why: 3 }), "bad-event"],
    ["a date that is not text", reopen("x", { at: 3 }), "bad-event"],
    ["an id that is not text", { type: "node.reopened", id: 3 }, "bad-event"],
    ["an unknown card", reopen("none"), "unknown-card"],
    ["an open card", reopen("o"), "reopen"],
    ["an option", reopen("opt"), "reopen"],
  ])("with %s", (_name, event, rule) => {
    const map = build(
      decided("x"),
      open("o"),
      {
        type: "node.proposed",
        id: "opt",
        kind: "option",
        title: "t",
        status: "open",
      },
      { type: "node.accepted", id: "opt", actor: "you" },
      event,
    );
    expect(rules(map)).toEqual([rule]);
  });

  test("on a removed card", () => {
    const map = build(
      decided("x"),
      { type: "node.removed", id: "x" },
      reopen("x"),
    );
    expect(rules(map)).toEqual(["unknown-card"]);
  });

  test("on a ghost", () => {
    const map = build(
      {
        type: "node.proposed",
        id: "g",
        kind: "card",
        title: "g",
        status: "open",
      },
      reopen("g"),
    );
    expect(rules(map)).toEqual(["reopen"]);
  });
});
