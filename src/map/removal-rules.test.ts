import { describe, expect, test } from "bun:test";
import { fold, type LogEntry } from "./fold.ts";

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: id,
  status: "open",
  ...extra,
});
const link = (from: string, to: string, type: string, why = "") => ({
  type: "edge.added",
  from,
  to,
  link: type,
  ...(why === "" ? {} : { why }),
});
const accept = (id: string) => ({ type: "node.accepted", id, actor: "you" });
const remove = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.removed",
  id,
  ...extra,
});
const restore = (id: string) => ({ type: "node.restored", id });
const build = (...events: unknown[]) =>
  fold(events.map((event, i): LogEntry => ({ line: i + 1, event })));
const ids = (map: ReturnType<typeof build>) => [...map.nodes.keys()].sort();
const rules = (map: ReturnType<typeof build>) =>
  map.problems.map((problem) => problem.rule);

// root > p > (c1, c2); option o and excerpt x on p; sources s (only p) and t (p and other).
const tree = [
  node("root"),
  node("p", { parent: "root" }),
  node("c1", { parent: "p" }),
  node("c2", { parent: "p" }),
  node("other", { parent: "root" }),
  node("o", { kind: "option" }),
  node("x", { kind: "excerpt" }),
  node("s", { kind: "source" }),
  node("t", { kind: "source" }),
  link("o", "p", "alternative_to"),
  link("p", "x", "supported_by"),
  link("p", "s", "supported_by"),
  link("p", "t", "supported_by"),
  link("other", "t", "supported_by"),
  link("c1", "other", "depends_on", "needs it"),
  accept("c1"),
  accept("c2"),
  accept("other"),
];

describe("remove", () => {
  test("takes the subtree, the options and excerpts, and the sources only it cites", () => {
    const map = build(...tree, remove("p"));
    expect(map.problems).toEqual([]);
    expect(ids(map)).toEqual(["other", "root", "t"]);
    expect(map.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual([
      "other>root",
      "other>t",
    ]);
    expect(map.parents.has("c1")).toBe(false);
    expect(map.removals.map((removal) => removal.id)).toEqual(["p"]);
  });

  test("restore brings every node back with its links", () => {
    const before = build(...tree);
    const after = build(...tree, remove("p"), restore("p"));
    expect(after.problems).toEqual([]);
    expect(ids(after)).toEqual(ids(before));
    const key = (map: typeof before) =>
      map.edges.map((e) => `${e.from}>${e.to}:${e.type}:${e.why}`).sort();
    expect(key(after)).toEqual(key(before));
    expect(after.parents).toEqual(before.parents);
    expect(after.waiting).toEqual([]);
    expect(after.removals).toEqual([]);
  });

  test("a reparent removal moves the children up, and the restore moves them back", () => {
    const moved = build(
      ...tree,
      link("c1", "x", "supported_by"),
      remove("p", { reparent: true }),
    );
    expect(moved.problems).toEqual([]);
    expect(moved.parents.get("c1")).toBe("root");
    expect(moved.parents.get("c2")).toBe("root");
    expect(ids(moved)).toEqual(["c1", "c2", "other", "root", "t"]);
    const back = build(...tree, remove("p", { reparent: true }), restore("p"));
    expect(back.parents.get("c1")).toBe("p");
    expect(back.parents.get("c2")).toBe("p");
    expect(back.parents.get("p")).toBe("root");
    expect(back.edges.filter((e) => e.to === "root")).toHaveLength(2);
  });

  test("a reparent restore finds a child that was removed in the meantime", () => {
    const map = build(
      ...tree,
      remove("p", { reparent: true }),
      remove("c1"),
      restore("p"),
      restore("c1"),
    );
    expect(map.problems).toEqual([]);
    expect(map.parents.get("c1")).toBe("p");
  });

  test("a link waits while an end is out and returns when both ends are in", () => {
    const map = build(...tree, remove("c1"), remove("other"));
    expect(map.waiting.some((e) => e.type === "depends_on")).toBe(true);
    const one = build(...tree, remove("c1"), remove("other"), restore("c1"));
    expect(one.problems).toEqual([]);
    expect(one.edges.some((e) => e.type === "depends_on")).toBe(false);
    const two = build(
      ...tree,
      remove("other"),
      remove("c1"),
      restore("other"),
      restore("c1"),
    );
    expect(two.problems).toEqual([]);
    expect(two.edges.some((e) => e.type === "depends_on")).toBe(true);
    expect(two.waiting).toEqual([]);
  });

  test("the example of the waiting rule", () => {
    const events = [
      node("login"),
      node("session"),
      link("login", "session", "depends_on", "needs a session"),
      accept("login"),
      accept("session"),
    ];
    const depends = (map: ReturnType<typeof build>) =>
      map.edges.some((edge) => edge.type === "depends_on");
    const step3 = build(
      ...events,
      remove("login"),
      remove("session"),
      restore("login"),
    );
    expect(step3.problems).toEqual([]);
    expect(depends(step3)).toBe(false);
    const step4 = build(...events, remove("session"), node("session"));
    expect(rules(step4)).toEqual(["duplicate-id"]);
    expect(step4.problems[0]?.detail).toContain("restore");
    const step5 = build(
      ...events,
      remove("login"),
      remove("session"),
      restore("login"),
      restore("session"),
    );
    expect(depends(step5)).toBe(true);
  });

  test("a source that a card outside the branch cites stays", () => {
    const map = build(...tree, remove("p"));
    expect(map.nodes.has("t")).toBe(true);
    expect(map.nodes.has("s")).toBe(false);
  });

  test("a branch removed earlier stays out when a card above is removed and restored", () => {
    const map = build(...tree, remove("c1"), remove("p"), restore("p"));
    expect(map.problems).toEqual([]);
    expect(map.nodes.has("c1")).toBe(false);
    expect(map.nodes.has("c2")).toBe(true);
    expect(map.removals.map((r) => r.id)).toEqual(["c1"]);
  });

  test("a node that went out with another card comes back only through it", () => {
    const map = build(...tree, remove("p"), restore("c1"), restore("zz"));
    expect(rules(map)).toEqual(["not-removed", "unknown-card"]);
    expect(map.problems[0]?.detail).toContain('restore "p"');
    expect(rules(build(...tree, restore("other")))).toEqual(["not-removed"]);
  });

  test("a card whose parent is still out is not restored", () => {
    const map = build(...tree, remove("c1"), remove("p"), restore("c1"));
    expect(rules(map)).toEqual(["parent-out"]);
    const parentOut = build(...tree, remove("p"), remove("root"), restore("p"));
    expect(rules(parentOut)).toEqual(["parent-out"]);
    const orphan = build(
      ...tree,
      remove("c1"),
      remove("p", { reparent: true }),
      restore("c1"),
    );
    expect(rules(orphan)).toEqual(["parent-out"]);
  });

  test("refuses on a ghost, on evidence, and for a reparent with no parent", () => {
    const map = build(
      ...tree,
      remove("ghost"),
      node("ghost"),
      remove("ghost"),
      remove("s"),
      remove("root", { reparent: true }),
      remove("p", { reparent: "yes" }),
      remove("p"),
      remove("p"),
    );
    expect(rules(map)).toEqual([
      "unknown-card",
      "remove-target",
      "remove-target",
      "no-grandparent",
      "bad-event",
      "unknown-card",
    ]);
    expect(map.problems.at(-1)?.detail).toContain("restore");
  });

  test("a removed card takes no note", () => {
    const map = build(...tree, remove("p"), {
      type: "note.added",
      id: "p",
      by: "me",
      text: "hi",
    });
    expect(rules(map)).toEqual(["unknown-card"]);
  });
});
