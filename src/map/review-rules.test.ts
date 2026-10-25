import { describe, expect, test } from "bun:test";
import type { RuleName } from "./fold.ts";
import {
  AT,
  build,
  decide,
  decided,
  kinds,
  link,
  open,
  reopen,
  review,
  rules,
} from "./mark-fixtures.ts";

/** X reopened; Y depends on X, Z on Y, W is a child of Y. Y is stale. */
const stale = (...extra: unknown[]) =>
  build(
    decided("x"),
    decided("y"),
    decided("z"),
    decided("w", { parent: "y" }),
    link("y", "x"),
    link("z", "y"),
    reopen("x", { why: "Charging moves to usage." }),
    ...extra,
  );

describe("a confirm", () => {
  test("is refused while the basis is open, with the fixing command", () => {
    const map = stale(review("y", { confirmed: ["x"] }));
    expect(rules(map)).toEqual(["review"]);
    expect(map.problems[0]?.detail).toContain("x (open)");
    expect(map.problems[0]?.detail).toContain("werk status x decided");
    expect(kinds(map, "y")).toEqual(["stale"]);
  });

  test("is refused while the basis is stale, with the fixing command", () => {
    const map = build(
      decided("x"),
      decided("w"),
      decided("y"),
      decided("z"),
      link("y", "x"),
      link("z", "y"),
      link("z", "w"),
      reopen("x"),
      decide("x"),
      reopen("w"),
      decide("w"),
      review("z", { confirmed: ["y", "w"] }),
    );
    expect(rules(map)).toEqual(["review"]);
    expect(map.problems[0]?.detail).toContain("y (stale)");
    expect(map.problems[0]?.detail).toContain(
      "werk rederive y --status decided",
    );
    expect(kinds(map, "z")).toEqual(["stale"]);
  });

  test("is refused when a link reason is not confirmed", () => {
    const map = stale(decide("x"), review("y", { confirmed: [] }));
    expect(rules(map)).toEqual(["review"]);
    expect(map.problems[0]?.detail).toContain("werk rederive y --confirm x");
  });

  test("clears the mark and marks nothing else", () => {
    const map = stale(decide("x"), review("y", { confirmed: ["x"] }));
    expect(rules(map)).toEqual([]);
    expect(["y", "z", "w"].map((id) => kinds(map, id))).toEqual([[], [], []]);
  });

  test("with no list of links is fine when the card has none", () => {
    const map = build(
      decided("x"),
      decided("c", { parent: "x" }),
      reopen("x"),
      decide("x"),
      review("c"),
    );
    expect(rules(map)).toEqual([]);
  });

  test("keeps the paused marks of the card", () => {
    const map = build(
      decided("p"),
      decided("q"),
      decided("x"),
      link("q", "p"),
      link("q", "x"),
      reopen("p", { reason: "postponed" }),
      reopen("x"),
    );
    expect(kinds(map, "q").sort()).toEqual(["paused", "stale"]);
  });

  test("leaves the paused mark when the review clears the stale one", () => {
    const map = build(
      decided("p"),
      decided("r"),
      decided("q"),
      decided("x"),
      link("r", "p"),
      link("q", "r"),
      link("q", "x"),
      reopen("p", { reason: "postponed" }),
      reopen("x"),
      decide("x"),
      review("q", { confirmed: ["r", "x"] }),
    );
    expect(kinds(map, "q")).toEqual(["paused"]);
  });
});

describe("an amend", () => {
  test("clears the card and marks the next hop with the review sentence", () => {
    const map = stale(
      decide("x"),
      review("y", {
        outcome: "amend",
        why: "The invoice now shows usage units.",
      }),
    );
    expect(rules(map)).toEqual([]);
    expect(kinds(map, "y")).toEqual([]);
    expect(kinds(map, "z")).toEqual(["stale"]);
    expect(kinds(map, "w")).toEqual(["stale"]);
    expect(map.nodes.get("z")?.marks[0]?.trace).toBe(
      `STALE from #y, amended on ${AT.slice(0, 10)}\n  The invoice now shows usage units.\n  z -> y: z takes y`,
    );
  });

  test("needs a sentence", () => {
    const map = stale(review("y", { outcome: "amend", why: "  " }));
    expect(rules(map)).toEqual(["review"]);
    expect(map.problems[0]?.detail).toContain('--amend "<what changed>"');
  });

  test("is allowed while the basis is open", () => {
    const map = stale(review("y", { outcome: "amend", why: "changed" }));
    expect(rules(map)).toEqual([]);
  });
});

describe("a review is refused", () => {
  test.each<[string, unknown, RuleName]>([
    ["an id that is not text", { type: "node.reviewed", id: 3 }, "bad-event"],
    ["an unknown outcome", review("y", { outcome: "skip" }), "bad-event"],
    ["a why that is not text", review("y", { why: 3 }), "bad-event"],
    ["a date that is not text", review("y", { at: 3 }), "bad-event"],
    ["links that are not a list", review("y", { confirmed: "x" }), "bad-event"],
    ["links that are not ids", review("y", { confirmed: [3] }), "bad-event"],
    ["an unknown card", review("none"), "unknown-card"],
    ["a card with no stale mark", review("z"), "review"],
  ])("with %s", (_name, event, rule) => {
    expect(rules(stale(event))).toEqual([rule]);
  });

  test("on a removed card", () => {
    const map = stale({ type: "node.removed", id: "z" }, review("z"));
    expect(rules(map)).toEqual(["unknown-card"]);
  });

  test("on a ghost", () => {
    const map = stale(
      {
        type: "node.proposed",
        id: "g",
        kind: "card",
        title: "g",
        status: "open",
      },
      review("g"),
    );
    expect(rules(map)).toEqual(["review"]);
  });
});

describe("a review that also decides", () => {
  test("clears the mark when the four facts hold", () => {
    const map = stale(
      decide("x"),
      review("y", { confirmed: ["x"], decide: true }),
    );
    expect(rules(map)).toEqual([]);
    expect(kinds(map, "y")).toEqual([]);
  });

  test("is refused when a fact is missing, and the mark stays", () => {
    const map = build(
      decided("x"),
      ...open("c", { parent: "x" }),
      { type: "node.edited", id: "c", who: "you" },
      reopen("x"),
      decide("x"),
      review("c", { decide: true }),
    );
    expect(rules(map)).toEqual(["contract"]);
    expect(kinds(map, "c")).toEqual(["stale"]);
  });
});
