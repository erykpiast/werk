import { describe, expect, test } from "bun:test";
import { checkDecide, missingFacts } from "./contract.ts";
import { type FoldedMap, fold, type LogEntry } from "./fold.ts";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Title ${id}`,
  status: "open",
  ...extra,
});
const link = (from: string, to: string, type: string) => ({
  type: "edge.added",
  from,
  to,
  link: type,
  ...(type === "depends_on" ? { why: "takes it" } : {}),
});
const kill = (id: string) => ({ type: "criterion.added", id, form: "revisit" });
const who = (id: string, value: string) => ({
  type: "node.edited",
  id,
  who: value,
});
const decide = (id: string) => ({ type: "node.decided", id });
const build = (...events: unknown[]): FoldedMap =>
  fold(events.map((event, i): LogEntry => ({ line: i + 1, event })));
const facts = (map: FoldedMap, id: string) =>
  missingFacts(map, map.nodes.get(id) as never).map((f) => f.split(":")[0]);

/** A decided root that other cards can stand on. */
const base = [
  card("root"),
  who("root", "me"),
  { type: "node.edited", id: "root", noBasis: "root of the tree" },
  kill("root"),
  decide("root"),
];

describe("missing facts", () => {
  test("a bare card lists who, basis, option and kill in that order", () => {
    const map = build(card("x"));
    expect(facts(map, "x")).toEqual(["who", "basis", "option", "kill"]);
  });

  test("each fix names the card id", () => {
    const map = build(card("x"));
    const text = checkDecide(map, "x")?.detail ?? "";
    expect(text).toContain("werk edit x --who");
    expect(text).toContain("werk link x <card> --type depends_on");
    expect(text).toContain("werk add x:opt0");
    expect(text).toContain("werk kill x");
  });

  test("who me needs no option, and prototype needs none either", () => {
    for (const value of ["me", "prototype"]) {
      const map = build(card("x"), who("x", value));
      expect(facts(map, "x")).toEqual(["basis", "kill"]);
    }
  });

  test("who you and an unset who both need an option", () => {
    expect(facts(build(card("x"), who("x", "you")), "x")).toContain("option");
    expect(facts(build(card("x")), "x")).toContain("option");
  });

  test("an option linked by alternative_to, or an option waiver, satisfies the option", () => {
    const withOption = build(
      card("x"),
      card("o", { kind: "option" }),
      link("o", "x", "alternative_to"),
    );
    expect(facts(withOption, "x")).not.toContain("option");
    const waived = build(card("x"), {
      type: "node.edited",
      id: "x",
      unchallenged: "no real choice",
    });
    expect(facts(waived, "x")).not.toContain("option");
  });

  test("a card that has an option linked from a non-option node still lacks one", () => {
    const map = build(card("x"), card("n"), link("n", "x", "supported_by"));
    expect(facts(map, "x")).toContain("option");
  });

  test("a decided parent or a decided depends_on target is a basis", () => {
    const parent = build(...base, card("c", { parent: "root" }));
    expect(facts(parent, "c")).not.toContain("basis");
    const dep = build(...base, card("c"), link("c", "root", "depends_on"));
    expect(facts(dep, "c")).not.toContain("basis");
  });

  test("an open basis is named in the refusal", () => {
    const map = build(card("p"), card("c", { parent: "p" }));
    const refusal = checkDecide(map, "c")?.detail ?? "";
    expect(refusal).toContain("p (open)");
  });

  test("a decided basis with a stale mark does not hold", () => {
    const map = build(...base, card("c", { parent: "root" }));
    map.nodes.get("root")?.marks.push({ kind: "stale", trace: "t" });
    expect(checkDecide(map, "c")?.detail).toContain("root (stale)");
  });

  test("a paused basis still holds", () => {
    const map = build(...base, card("c", { parent: "root" }));
    map.nodes.get("root")?.marks.push({ kind: "paused", trace: "t" });
    expect(facts(map, "c")).not.toContain("basis");
  });

  test("a real card does not take a ghost basis, a ghost does", () => {
    const ghostBasis = (id: string) =>
      build(
        card("g"),
        who("g", "me"),
        { type: "node.edited", id: "g", noBasis: "r" },
        kill("g"),
        decide("g"),
        card(id),
        link(id, "g", "depends_on"),
      );
    expect(facts(ghostBasis("x"), "x")).not.toContain("basis");
    const real = ghostBasis("x");
    (real.nodes.get("x") as { proposed: boolean }).proposed = false;
    expect(facts(real, "x")).toContain("basis");
  });

  test("a basis waiver does not lift an open basis", () => {
    const map = build(card("p"), card("c", { parent: "p" }), {
      type: "node.edited",
      id: "c",
      noBasis: "root of a tree",
    });
    expect(checkDecide(map, "c")?.detail).toContain("p (open)");
  });

  test("one open depends_on target blocks a card with a decided parent", () => {
    const map = build(
      ...base,
      card("o"),
      card("c", { parent: "root" }),
      link("c", "o", "depends_on"),
    );
    expect(checkDecide(map, "c")?.detail).toContain("o (open)");
  });
});

describe("decide", () => {
  test("a card with every fact becomes decided", () => {
    const map = build(
      ...base,
      card("c", { parent: "root" }),
      who("c", "me"),
      kill("c"),
      decide("c"),
    );
    expect(map.nodes.get("c")?.status).toBe("decided");
    expect(map.problems).toEqual([]);
  });

  test("a refused decide leaves the status open and is set aside as a problem", () => {
    const map = build(card("c"), decide("c"));
    expect(map.nodes.get("c")?.status).toBe("open");
    expect(map.problems.map((p) => p.rule)).toEqual(["contract"]);
  });

  test("a ghost with held basis, option and criterion is decided and stays a ghost", () => {
    const map = build(
      ...base,
      card("g"),
      card("o", { kind: "option" }),
      who("g", "you"),
      link("g", "root", "depends_on"),
      link("o", "g", "alternative_to"),
      kill("g"),
      decide("g"),
    );
    expect(map.problems).toEqual([]);
    expect(map.nodes.get("g")).toMatchObject({
      status: "decided",
      proposed: true,
    });
  });

  test("an unknown card, an option and a decided card are refused", () => {
    expect(checkDecide(build(), "zz")?.rule).toBe("unknown-card");
    const opt = build(card("o", { kind: "option" }));
    expect(checkDecide(opt, "o")?.detail).toContain("an option");
    const src = build(card("s", { kind: "source" }));
    expect(checkDecide(src, "s")?.detail).toContain("a source");
    expect(build(...base, decide("root")).problems[0]?.detail).toContain(
      "already decided",
    );
  });
});

describe("waivers and criteria", () => {
  test("a waiver with an empty reason is refused and stores nothing", () => {
    for (const key of ["noBasis", "unchallenged"]) {
      const map = build(card("x"), {
        type: "node.edited",
        id: "x",
        [key]: " ",
      });
      expect(map.problems.map((p) => p.rule)).toEqual(["waiver"]);
      expect(map.nodes.get("x")?.[key as "noBasis"]).toBeNull();
    }
  });

  test("an edit of a decided card that drops a fact is refused", () => {
    const map = build(...base, who("root", "you"));
    expect(map.problems[0]?.rule).toBe("contract");
  });

  test("a criterion needs every field of its form, and a card", () => {
    const rules = (event: unknown) =>
      build(card("x"), event).problems.map((p) => p.rule);
    expect(rules({ type: "criterion.added", id: "x", form: "nope" })).toEqual([
      "bad-event",
    ]);
    expect(
      rules({ type: "criterion.added", id: "x", form: "metric", metric: "m" }),
    ).toEqual(["bad-event"]);
    expect(rules({ type: "criterion.added", id: 3, form: "revisit" })).toEqual([
      "bad-event",
    ]);
    expect(
      rules({ type: "criterion.added", id: "zz", form: "revisit" }),
    ).toEqual(["unknown-card"]);
    expect(
      rules({
        type: "criterion.added",
        id: "x",
        form: "manual",
        test: "use it",
      }),
    ).toEqual([]);
    expect(rules({ type: "node.decided", id: 3 })).toEqual(["bad-event"]);
  });

  test("a criterion can be added to a decided card", () => {
    const map = build(...base, kill("root"));
    expect(map.nodes.get("root")?.kill).toHaveLength(2);
  });
});
