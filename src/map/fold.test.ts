import { describe, expect, test } from "bun:test";
import { applyEvent, emptyMap, fold, type LogEntry, parseLog } from "./fold.ts";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
const link = (from: string, to: string, type = "refines") => ({
  type: "edge.added",
  from,
  to,
  link: type,
  ...(type === "depends_on" ? { why: "takes the grid" } : {}),
});
const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));
const rules = (...events: unknown[]) =>
  fold(entries(...events)).problems.map((p) => p.rule);

describe("parseLog", () => {
  test("skips blank lines and keeps the line numbers", () => {
    const parsed = parseLog('{"a":1}\n\n{"b":2}\n');
    expect(parsed.map((e) => e.line)).toEqual([1, 3]);
  });

  test("a line that is not JSON carries its error", () => {
    const [entry] = parseLog("not json");
    expect(entry?.error).toBeString();
  });
});

describe("fold", () => {
  test("a card added under a parent is one ghost with one held edge", () => {
    const map = fold(entries(node("a"), node("b", { parent: "a" })));
    expect(map.nodes.get("b")?.proposed).toBe(true);
    expect(map.ghostEdges).toEqual([
      { from: "b", to: "a", type: "refines", why: "" },
    ]);
    expect(map.edges).toEqual([]);
    expect(map.parents.get("b")).toBe("a");
    expect(map.problems).toEqual([]);
  });

  test("the node keeps every word it was given", () => {
    const map = fold(
      entries(
        node("o", {
          kind: "option",
          why: "w",
          body: "b",
        }),
      ),
    );
    expect(map.nodes.get("o")).toMatchObject({
      why: "w",
      body: "b",
      marks: [],
    });
  });

  test("a bad line is a problem with its place, and later events still fold", () => {
    const map = fold([
      ...entries(node("a")),
      { line: 2, event: null, error: "boom" },
      { line: 3, event: node("b") },
    ]);
    expect(map.problems).toEqual([
      { line: 2, rule: "bad-json", detail: "boom" },
    ]);
    expect([...map.nodes.keys()]).toEqual(["a", "b"]);
  });

  test("an edge between two real nodes is live", () => {
    const map = emptyMap();
    for (const id of ["a", "b"]) {
      applyEvent(map, node(id));
      const n = map.nodes.get(id);
      if (n) n.proposed = false;
    }
    expect(applyEvent(map, link("b", "a", "depends_on"))).toBeNull();
    expect(map.edges).toHaveLength(1);
    expect(map.ghostEdges).toHaveLength(0);
  });
});

describe("the rules", () => {
  test("a duplicate id", () => {
    expect(rules(node("a"), node("a"))).toEqual(["duplicate-id"]);
  });

  test("an unknown parent and an unknown link end", () => {
    expect(rules(node("a", { parent: "x" }))).toEqual(["unknown-card"]);
    expect(rules(node("a"), link("a", "x"), link("x", "a"))).toEqual([
      "unknown-card",
      "unknown-card",
    ]);
  });

  test("a second parent", () => {
    expect(
      rules(node("a"), node("b"), node("c"), link("c", "a"), link("c", "b")),
    ).toEqual(["second-parent"]);
  });

  test("a cycle, direct and through a chain", () => {
    expect(rules(node("a"), link("a", "a"))).toEqual(["cycle"]);
    expect(
      rules(
        node("a"),
        node("b", { parent: "a" }),
        node("c", { parent: "b" }),
        link("a", "c"),
      ),
    ).toEqual(["cycle"]);
  });

  test("an option links by alternative_to only", () => {
    expect(
      rules(node("a"), node("o", { kind: "option", parent: "a" })),
    ).toEqual(["option-link"]);
    expect(
      rules(
        node("a"),
        node("o", { kind: "option" }),
        link("o", "a", "refines"),
      ),
    ).toEqual(["option-link"]);
    expect(
      rules(
        node("a"),
        node("o", { kind: "option" }),
        link("o", "a", "alternative_to"),
      ),
    ).toEqual([]);
  });

  test("a refused event leaves the map as it was", () => {
    const map = emptyMap();
    applyEvent(map, node("a"));
    expect(applyEvent(map, node("a", { title: "other" }))?.rule).toBe(
      "duplicate-id",
    );
    expect(map.nodes.get("a")?.title).toBe("Title a");
  });

  test("a malformed event is a bad-event", () => {
    expect(rules(5, [], { type: "x" })).toEqual([
      "bad-event",
      "bad-event",
      "bad-event",
    ]);
    expect(rules(node("")).concat(rules(node("a", { title: 3 })))).toEqual([
      "bad-event",
      "bad-event",
    ]);
    expect(
      rules(
        node("a", { kind: "x" }),
        node("a", { status: "x" }),
        node("a", { why: 1 }),
      ),
    ).toEqual(["bad-event", "bad-event", "bad-event"]);
    expect(
      rules({ type: "edge.added", from: 1, to: "a", link: "refines" }),
    ).toEqual(["bad-event"]);
    expect(
      rules({ type: "edge.added", from: "a", to: "b", link: "x" }),
    ).toEqual(["bad-event"]);
    expect(
      rules({
        type: "edge.added",
        from: "a",
        to: "b",
        link: "refines",
        why: 1,
      }),
    ).toEqual(["bad-event"]);
  });
});

describe("depends_on links", () => {
  const dep = (from: string, to: string, why?: string) => ({
    type: "edge.added",
    from,
    to,
    link: "depends_on",
    ...(why === undefined ? {} : { why }),
  });

  test("linking the same pair again replaces the reason", () => {
    const map = fold(
      entries(node("a"), node("b"), dep("a", "b", "one"), dep("a", "b", "two")),
    );
    expect(map.problems).toEqual([]);
    expect(map.ghostEdges).toEqual([
      { from: "a", to: "b", type: "depends_on", why: "two" },
    ]);
  });

  test("a link without a reason is refused", () => {
    expect(rules(node("a"), node("b"), dep("a", "b"))).toEqual(["link-why"]);
  });

  test("a link on a ghost is held, and the live edges leave it out", () => {
    const map = fold(entries(node("a"), node("b"), dep("a", "b", "w")));
    expect(map.edges).toEqual([]);
    expect(map.ghostEdges).toHaveLength(1);
  });
});
