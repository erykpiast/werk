import { describe, expect, test } from "bun:test";
import { applyEvent, fold, type LogEntry } from "./fold.ts";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: id,
  status: "open",
  ...extra,
});
const link = (from: string, to: string, type: string) => ({
  type: "edge.added",
  from,
  to,
  link: type,
});
const accept = (id: string, ...actor: (string | null)[]) => ({
  type: "node.accepted",
  id,
  ...(actor[0] === null ? {} : { actor: actor[0] ?? "you" }),
});
const discard = (id: string) => ({ type: "node.discarded", id });
const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));
const build = (...events: unknown[]) => fold(entries(...events));
const ids = (map: ReturnType<typeof build>) => [...map.nodes.keys()].sort();

// The example of #werk-propose-new-carry.
const carry = [
  node("C"),
  node("C:ex0", { kind: "excerpt" }),
  node("S", { kind: "source" }),
  node("D"),
  node("T", { kind: "source" }),
  link("C", "C:ex0", "supported_by"),
  link("C", "S", "supported_by"),
  link("C", "T", "supported_by"),
  link("D", "S", "supported_by"),
];

describe("accept", () => {
  test("refuses without the person's statement, and changes nothing", () => {
    for (const actor of [null, "me"]) {
      const map = build(node("a"), accept("a", actor));
      expect(map.problems.map((p) => p.rule)).toEqual(["accept-actor"]);
      expect(map.nodes.get("a")?.proposed).toBe(true);
    }
  });

  test("refuses an unknown card and a real card", () => {
    const map = build(node("a"), accept("a"), accept("a"), accept("zz"));
    expect(map.problems.map((p) => p.rule)).toEqual([
      "not-ghost",
      "unknown-card",
    ]);
  });

  test("a ghost child takes its ghost parent, and the held edge goes live", () => {
    const map = build(node("p"), node("c", { parent: "p" }), accept("c"));
    expect(map.nodes.get("p")?.proposed).toBe(false);
    expect(map.nodes.get("c")?.proposed).toBe(false);
    expect(map.edges).toHaveLength(1);
    expect(map.ghostEdges).toHaveLength(0);
  });

  test("stops at the first real card, and leaves a sibling ghost", () => {
    const map = build(
      node("r"),
      accept("r"),
      node("p", { parent: "r" }),
      node("c", { parent: "p" }),
      node("sib", { parent: "p" }),
      accept("c"),
    );
    expect(map.problems).toEqual([]);
    expect(map.nodes.get("p")?.proposed).toBe(false);
    expect(map.nodes.get("sib")?.proposed).toBe(true);
    expect(map.edges.map((e) => e.from).sort()).toEqual(["c", "p"]);
    expect(map.ghostEdges.map((e) => e.from)).toEqual(["sib"]);
  });

  test("takes the ghost sources, excerpts and options of the accepted cards, and of their ancestors", () => {
    const map = build(
      node("p"),
      node("c", { parent: "p" }),
      node("s", { kind: "source" }),
      node("x", { kind: "excerpt" }),
      node("o", { kind: "option" }),
      node("ps", { kind: "source" }),
      link("c", "s", "supported_by"),
      link("c", "x", "supported_by"),
      link("o", "c", "alternative_to"),
      link("p", "ps", "supported_by"),
      accept("c"),
    );
    expect(map.problems).toEqual([]);
    expect([...map.nodes.values()].every((n) => !n.proposed)).toBe(true);
    expect(map.ghostEdges).toEqual([]);
    expect(map.edges).toHaveLength(5);
  });

  test("a real source stays as it was, and a ghost that another ghost cites stays held", () => {
    const map = build(
      node("s", { kind: "source" }),
      accept("s"),
      node("a"),
      node("b"),
      link("a", "s", "supported_by"),
      link("a", "b", "supported_by"),
      accept("a"),
    );
    expect(map.nodes.get("s")?.proposed).toBe(false);
    expect(map.nodes.get("b")?.proposed).toBe(true);
    expect(map.edges.map((e) => e.to)).toEqual(["s"]);
    expect(map.ghostEdges.map((e) => e.to)).toEqual(["b"]);
  });
});

describe("discard", () => {
  test("refuses an unknown card and a real card", () => {
    const map = build(node("a"), accept("a"), discard("a"), discard("zz"));
    expect(map.problems.map((p) => p.rule)).toEqual([
      "not-ghost",
      "unknown-card",
    ]);
    expect(ids(map)).toEqual(["a"]);
  });

  test("drops the ghost descendants, and a real card stays", () => {
    const map = build(
      node("r"),
      accept("r"),
      node("p", { parent: "r" }),
      node("c", { parent: "p" }),
      discard("p"),
    );
    expect(map.problems).toEqual([]);
    expect(ids(map)).toEqual(["r"]);
    expect(map.parents.size).toBe(0);
    expect(map.ghostEdges).toEqual([]);
  });

  test("drops the excerpt and the options of a dropped card, and a source only it cited", () => {
    const map = build(...carry, discard("C"));
    expect(map.problems).toEqual([]);
    expect(ids(map)).toEqual(["D", "S"]);
    expect(map.ghostEdges).toEqual([
      { from: "D", to: "S", type: "supported_by", why: "" },
    ]);
  });

  test("drops an option that points at a dropped card", () => {
    const map = build(
      node("a"),
      node("o", { kind: "option" }),
      link("o", "a", "alternative_to"),
      discard("a"),
    );
    expect(ids(map)).toEqual([]);
  });

  test("a source that a real card cites stays", () => {
    const map = build(
      node("s", { kind: "source" }),
      node("a"),
      accept("a"),
      node("b"),
      link("b", "s", "supported_by"),
      link("a", "s", "supported_by"),
      discard("b"),
    );
    expect(map.problems).toEqual([]);
    expect(ids(map)).toEqual(["a", "s"]);
  });

  test("accepting D after discarding C makes D and S real together", () => {
    const map = build(...carry, discard("C"), accept("D"));
    expect(ids(map)).toEqual(["D", "S"]);
    expect([...map.nodes.values()].every((n) => !n.proposed)).toBe(true);
    expect(map.edges).toHaveLength(1);
  });

  test("a refused discard leaves the map as it was", () => {
    const map = build(node("a"), accept("a"));
    expect(applyEvent(map, discard("a"))?.rule).toBe("not-ghost");
    expect(map.nodes.has("a")).toBe(true);
  });
});

describe("a real card under a ghost", () => {
  test("is refused, and a ghost under a ghost or a real card is not", () => {
    const rules = (...events: unknown[]) =>
      build(...events).problems.map((p) => p.rule);
    expect(
      rules(node("g"), node("y"), accept("y"), link("y", "g", "refines")),
    ).toEqual(["ghost-parent"]);
    expect(rules(node("g"), node("y"), link("y", "g", "refines"))).toEqual([]);
    expect(
      rules(node("x"), accept("x"), node("g"), link("g", "x", "refines")),
    ).toEqual([]);
  });
});
