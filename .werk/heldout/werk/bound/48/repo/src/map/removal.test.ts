import { expect, test } from "bun:test";
import { fold } from "./fold.ts";
import { removalHolding, removalOf } from "./removal.ts";
import type { Draft, FoldedMap, NodeKind } from "./types.ts";

const node = (id: string, kind: NodeKind, parent?: string, type: Draft["type"] = "node.added"): Draft =>
  ({
    type,
    actor: "agent",
    payload: { id, kind, title: id, ...(parent === undefined ? {} : { parent }) },
  }) as Draft;
const link = (from: string, to: string, type: "supported_by" | "alternative_to"): Draft => ({
  type: "edge.added",
  actor: "agent",
  payload: { from, to, type },
});
// Only a quote creates an excerpt, with its link from the citing card in the same event.
const quote = (id: string, card: string): Draft => ({
  type: "excerpt.quoted",
  actor: "agent",
  payload: {
    id,
    title: "Q",
    card,
    conversation: "c",
    session: "s",
    message: 0,
    start: 0,
    end: 1,
    speaker: "person",
    said_at: "t",
  },
});
const mapOf = (...drafts: Draft[]): FoldedMap => {
  const map = fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));
  expect(map.problems).toEqual([]);
  return map;
};

// root
//  ├ c ── c:opt0 (option), c:ex0 (excerpt), shared (source, D cites it too), own (source)
//  │ ├ c1 (cites own as well)
//  │ └ c2 (ghost)
//  └ d ── shared
const base = () =>
  mapOf(
    node("root", "card"),
    node("c", "card", "root"),
    node("c1", "card", "c"),
    node("c2", "card", "c", "node.proposed"),
    node("d", "card", "root"),
    node("c:opt0", "option"),
    link("c:opt0", "c", "alternative_to"),
    quote("c:ex0", "c"),
    node("shared", "source"),
    link("c", "shared", "supported_by"),
    link("d", "shared", "supported_by"),
    node("own", "source"),
    link("c", "own", "supported_by"),
    link("c1", "own", "supported_by"),
  );

test("a removal takes the card, its subtree, its options and excerpts, and the sources only they cite", () => {
  expect(removalOf(base(), "c", false)).toEqual({ taken: ["c", "c1", "c2", "c:opt0", "c:ex0", "own"] });
});

test("a reparent takes only the card and its own evidence, and moves the children to its parent", () => {
  expect(removalOf(base(), "c", true)).toEqual({
    taken: ["c", "c:opt0", "c:ex0"],
    moved: { children: ["c1", "c2"], to: "root" },
  });
});

test("a reparent of a card with no children moves nothing", () => {
  expect(removalOf(base(), "d", true)).toEqual({ taken: ["d"] });
});

test("a branch removed earlier is out already, so a removal above it does not take it", () => {
  const map = mapOf(node("root", "card"), node("c", "card", "root"), node("c1", "card", "c"), {
    type: "node.removed",
    actor: "you",
    payload: { id: "c1" },
  });
  expect(removalOf(map, "c", false)).toEqual({ taken: ["c"] });
  expect(removalHolding(map, "c1")).toBe("c1");
  expect(removalHolding(map, "c")).toBeUndefined();
});

test("each node out names the removal that took it", () => {
  const map = mapOf(node("root", "card"), node("c", "card", "root"), node("c1", "card", "c"), {
    type: "node.removed",
    actor: "you",
    payload: { id: "c" },
  });
  expect(removalHolding(map, "c1")).toBe("c");
  expect(removalHolding(map, "root")).toBeUndefined();
});
