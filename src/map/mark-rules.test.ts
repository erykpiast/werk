import { describe, expect, test } from "bun:test";
import type { MapNode } from "./fold.ts";
import {
  AT,
  build,
  decide,
  decided,
  ghost,
  kinds,
  link,
  open,
  reopen,
  review,
} from "./mark-fixtures.ts";
import {
  basisOf,
  basisWaiting,
  clearResumed,
  fixBasis,
  holds,
  markDownstream,
  markNextHop,
  markPostponed,
  traceText,
} from "./mark-rules.ts";

const node = (map: ReturnType<typeof build>, id: string) =>
  map.nodes.get(id) as MapNode;

describe("traces", () => {
  const base = {
    origin: "B",
    reason: "amended" as const,
    at: AT,
    text: "now usage",
    link: { from: "A1", to: "B", type: "depends_on" as const, why: "needs B" },
    via: [],
  };

  test("a stale trace names the origin, the reason, the date, the text and the link", () => {
    expect(traceText({ ...base, kind: "stale" })).toBe(
      "STALE from #B, amended on 2026-10-10\n  now usage\n  A1 -> B: needs B",
    );
  });

  test("a trace with no date, text or link reason leaves those lines out", () => {
    const text = traceText({
      ...base,
      kind: "stale",
      at: "",
      text: "",
      link: { ...base.link, why: "" },
    });
    expect(text).toBe("STALE from #B, amended\n  A1 -> B");
  });

  test("a paused trace names the cards between, nearest first, and the last link type", () => {
    const text = traceText({
      ...base,
      kind: "paused",
      origin: "P",
      reason: "postponed",
      via: ["Q", "R"],
    });
    expect(text).toContain("via Q, R (nearest to P first)");
    expect(text).toContain("last hop: depends_on");
  });

  test("a postponed card's own trace has no origin line", () => {
    const text = traceText({
      ...base,
      kind: "postponed",
      reason: "postponed",
      link: null,
    });
    expect(text).toBe("POSTPONED on 2026-10-10\n  now usage");
    expect(traceText({ ...base, kind: "postponed", text: "", at: "" })).toBe(
      "POSTPONED",
    );
  });
});

describe("marking", () => {
  const chain = [
    ...decided("p"),
    ...decided("q"),
    ...decided("r"),
    ...decided("s"),
    link("q", "p"),
    link("r", "q", "refines"),
    link("s", "r"),
  ];
  const cause = { origin: "p", reason: "postponed" as const, at: AT, text: "" };

  test("the next hop is marked and no further", () => {
    const map = build(chain);
    markNextHop(map, "p", { ...cause, reason: "invalidated" });
    expect(kinds(map, "q")).toEqual(["stale"]);
    expect(kinds(map, "r")).toEqual([]);
  });

  test("a walk down marks every card, and a trace holds the cards between", () => {
    const map = build(chain);
    markDownstream(map, "p", cause);
    const via = (id: string) => node(map, id).marks[0]?.via;
    expect(via("q")).toEqual([]);
    expect(via("r")).toEqual(["q"]);
    expect(via("s")).toEqual(["q", "r"]);
    expect(node(map, "s").marks[0]?.link?.type).toBe("depends_on");
  });

  test("a walk through a diamond reaches each card once", () => {
    const map = build(
      decided("p"),
      decided("a"),
      decided("b"),
      decided("c"),
      link("a", "p"),
      link("b", "p"),
      link("c", "a"),
      link("c", "b"),
    );
    markDownstream(map, "p", cause);
    expect(node(map, "c").marks).toHaveLength(1);
  });

  test("a second mark from the same origin replaces the first", () => {
    const map = build(chain);
    markNextHop(map, "p", { ...cause, reason: "invalidated", text: "one" });
    markNextHop(map, "p", { ...cause, reason: "rejected", text: "two" });
    expect(node(map, "q").marks.map((m) => m.text)).toEqual(["two"]);
  });

  test("a stale and a paused mark sit side by side in either order", () => {
    const map = build(chain);
    markNextHop(map, "p", { ...cause, reason: "invalidated" });
    markDownstream(map, "p", cause);
    expect(kinds(map, "q").sort()).toEqual(["paused", "stale"]);
    const other = build(chain);
    markDownstream(other, "p", cause);
    markNextHop(other, "p", { ...cause, reason: "invalidated" });
    expect(kinds(other, "q").sort()).toEqual(["paused", "stale"]);
  });

  test("clearing a resume removes the own mark and the paused marks it caused only", () => {
    const map = build(chain, decided("o"), decided("t"), link("t", "o"));
    markPostponed(node(map, "p"), cause);
    markDownstream(map, "p", cause);
    markDownstream(map, "o", { ...cause, origin: "o" });
    markNextHop(map, "p", { ...cause, reason: "invalidated" });
    clearResumed(map, "p");
    expect(kinds(map, "p")).toEqual([]);
    expect(kinds(map, "r")).toEqual([]);
    expect(kinds(map, "q")).toEqual(["stale"]);
    expect(kinds(map, "t")).toEqual(["paused"]);
    clearResumed(map, "nobody");
  });
});

describe("basis", () => {
  test("a paused card holds, a stale or open card does not", () => {
    const map = build(decided("a"), open("b"), decided("c"));
    markDownstream(map, "c", {
      origin: "c",
      reason: "postponed",
      at: "",
      text: "",
    });
    expect(holds(node(map, "a"))).toBe(true);
    expect(holds(node(map, "b"))).toBe(false);
    markNextHop(map, "a", {
      origin: "a",
      reason: "invalidated",
      at: "",
      text: "",
    });
    expect(holds(node(map, "a"))).toBe(true);
  });

  test("the basis is the parent and the depends_on targets, real cards only", () => {
    const map = build(
      decided("root"),
      decided("t"),
      ghost("g", { parent: "root" }),
      open("c", { parent: "root" }),
      link("c", "t"),
      link("c", "g"),
    );
    // g is a ghost? no: it is a ghost until accepted, so it is left out
    expect(basisOf(map, node(map, "c")).map((n) => n.id)).toEqual([
      "root",
      "t",
    ]);
    expect(basisOf(map, node(map, "root"))).toEqual([]);
  });

  test("a card waits on an open basis and on a stale one, with the fixing command", () => {
    const map = build(
      decided("x"),
      decided("y"),
      link("y", "x"),
      open("n"),
      link("n", "y"),
      reopen("x"),
    );
    expect(basisWaiting(map, node(map, "n")).map((t) => t.id)).toEqual(["y"]);
    expect(fixBasis(node(map, "y"))).toBe("werk rederive y --status decided");
    expect(fixBasis(node(map, "x"))).toBe("werk status x decided");
    expect(basisWaiting(map, node(map, "y")).map((t) => t.id)).toEqual(["x"]);
  });
});

test("a link made after the change carries no mark", () => {
  const map = build(
    decided("x"),
    decided("y"),
    link("y", "x"),
    reopen("x"),
    decided("late"),
    link("late", "x"),
  );
  expect(kinds(map, "y")).toEqual(["stale"]);
  expect(kinds(map, "late")).toEqual([]);
  expect(map.problems).toEqual([]);
});

test("a decided postponed card resumes its work", () => {
  const map = build(
    decided("p"),
    decided("q"),
    link("q", "p"),
    reopen("p", { reason: "postponed" }),
  );
  expect(kinds(map, "p")).toEqual(["postponed"]);
  expect(kinds(map, "q")).toEqual(["paused"]);
  const resumed = build(
    decided("p"),
    decided("q"),
    link("q", "p"),
    reopen("p", { reason: "postponed" }),
    decide("p"),
  );
  expect(kinds(resumed, "p")).toEqual([]);
  expect(kinds(resumed, "q")).toEqual([]);
  void review;
});
