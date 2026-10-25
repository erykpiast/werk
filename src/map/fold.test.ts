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

describe("ghost events", () => {
  const edit = (fields: Record<string, unknown>) => ({
    type: "node.edited",
    id: "a",
    ...fields,
  });
  const note = (id: string, text = "n") => ({
    type: "note.added",
    id,
    by: "person",
    text,
  });

  test("an edit of why or body refuses on a ghost; who works on it", () => {
    expect(rules(node("a"), edit({ body: "x" }), edit({ why: "x" }))).toEqual([
      "frozen",
      "frozen",
    ]);
    const map = fold(entries(node("a"), edit({ who: "you" })));
    expect(map.problems).toEqual([]);
    expect(map.nodes.get("a")?.who).toBe("you");
  });

  test("an edit of the words of a real card refuses too", () => {
    expect(
      rules(
        node("a"),
        { type: "node.accepted", id: "a", actor: "you" },
        edit({ body: "b", why: "w" }),
      ),
    ).toEqual(["frozen"]);
  });

  test("a bad edit, accept, discard or note is a bad-event or an unknown card", () => {
    expect(
      rules(
        node("a"),
        { type: "node.edited" },
        edit({ who: "x" }),
        edit({ why: 1 }),
        edit({ body: 1 }),
        { type: "node.edited", id: "zz" },
        { type: "node.accepted" },
        { type: "node.discarded" },
        { type: "note.added", by: "a", text: "t" },
        { type: "note.added", id: "a", text: "t" },
        { type: "note.added", id: "a", by: "a", text: "" },
        node("b", { who: "x" }),
        node("c", { who: 1 }),
      ),
    ).toEqual([
      "bad-event",
      "bad-event",
      "bad-event",
      "bad-event",
      "unknown-card",
      "bad-event",
      "bad-event",
      "bad-event",
      "bad-event",
      "bad-event",
      "bad-event",
      "bad-event",
    ]);
  });

  test("a note on an unknown card is refused, and a thread outlives its card", () => {
    expect(rules(note("zz"))).toEqual(["unknown-card"]);
    const map = fold(
      entries(node("a"), note("a", "N1"), { type: "node.discarded", id: "a" }),
    );
    expect(map.nodes.has("a")).toBe(false);
    expect(map.threads.get("a")).toHaveLength(1);
    expect(
      rules(node("a"), { type: "node.discarded", id: "a" }, note("a")),
    ).toEqual(["unknown-card"]);
  });
});

describe("waivers, criteria and decide", () => {
  const edit = (fields: Record<string, unknown>) => ({
    type: "node.edited",
    id: "a",
    ...fields,
  });
  const kill = (fields: Record<string, unknown>) => ({
    type: "criterion.added",
    id: "a",
    ...fields,
  });

  test("a waiver is stored with its reason, and an empty reason is refused", () => {
    const map = fold(
      entries(node("a"), edit({ noBasis: "root", unchallenged: "no choice" })),
    );
    expect(map.nodes.get("a")).toMatchObject({
      noBasis: "root",
      unchallenged: "no choice",
    });
    expect(rules(node("a"), edit({ noBasis: "" }))).toEqual(["waiver"]);
    expect(rules(node("a"), edit({ unchallenged: " " }))).toEqual(["waiver"]);
    expect(rules(node("a"), edit({ noBasis: 3 }))).toEqual(["bad-event"]);
  });

  test("each form of criterion is stored, and a missing part is refused", () => {
    const map = fold(
      entries(
        node("a"),
        kill({ form: "revisit" }),
        kill({ form: "manual", test: "use it" }),
        kill({ form: "no-metric", reason: "cheap" }),
        kill({
          form: "metric",
          source: "s",
          metric: "m",
          threshold: "t",
          window: "w",
          sample: "n",
        }),
      ),
    );
    expect(map.problems).toEqual([]);
    expect(map.nodes.get("a")?.kill.map((c) => c.form)).toEqual([
      "revisit",
      "manual",
      "no-metric",
      "metric",
    ]);
    expect(
      rules(
        node("a"),
        kill({ form: "metric", metric: "m" }),
        kill({ form: "x" }),
      ),
    ).toEqual(["bad-event", "bad-event"]);
    expect(rules(kill({ form: "revisit" }))).toEqual(["unknown-card"]);
    expect(rules({ type: "criterion.added", form: "revisit" })).toEqual([
      "bad-event",
    ]);
  });

  test("a decide runs the contract, and a decided card refuses an edit that drops a fact", () => {
    const decide = { type: "node.decided", id: "a" };
    expect(rules(node("a"), decide)).toEqual(["contract"]);
    expect(rules({ type: "node.decided" })).toEqual(["bad-event"]);
    const map = fold(
      entries(
        node("a"),
        edit({ who: "me", noBasis: "root" }),
        kill({ form: "revisit" }),
        decide,
        decide,
        edit({ who: "you" }),
      ),
    );
    expect(map.nodes.get("a")?.status).toBe("decided");
    expect(map.problems.map((p) => p.rule)).toEqual(["contract", "contract"]);
  });
});

describe("removal events", () => {
  const accepted = (id: string) => ({
    type: "node.accepted",
    id,
    actor: "you",
  });
  const base = [node("p"), node("c", { parent: "p" }), accepted("c")];

  test("a removal and its restore fold as one pair", () => {
    const out = fold(entries(...base, { type: "node.removed", id: "c" }));
    expect(out.problems).toEqual([]);
    expect(out.removals.map((r) => r.id)).toEqual(["c"]);
    const back = fold(
      entries(
        ...base,
        { type: "node.removed", id: "c" },
        { type: "node.restored", id: "c" },
      ),
    );
    expect(back.removals).toEqual([]);
  });

  test("a kill criterion and a decide on a removed node name the restore", () => {
    const removed = [...base, { type: "node.removed", id: "p" }];
    const out = fold(
      entries(
        ...removed,
        { type: "criterion.added", id: "c", form: "revisit" },
        { type: "node.decided", id: "c" },
      ),
    );
    expect(out.problems.map((p) => p.detail)).toEqual([
      '"c" is removed with "p"; restore "p" first',
      '"c" is removed with "p"; restore "p" first',
    ]);
    const own = fold(entries(...removed, { type: "node.decided", id: "p" }));
    expect(own.problems[0]?.detail).toBe('"p" is removed; restore "p" first');
  });

  test("a removal event that is not well formed is refused", () => {
    expect(
      rules(
        ...base,
        { type: "node.removed", id: 1 },
        { type: "node.removed", id: "c", reparent: "yes" },
        { type: "node.restored" },
      ),
    ).toEqual(["bad-event", "bad-event", "bad-event"]);
  });

  test("a removed id is taken", () => {
    expect(
      rules(...base, { type: "node.removed", id: "c" }, node("c")),
    ).toEqual(["duplicate-id"]);
  });
});
