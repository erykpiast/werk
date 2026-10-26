import { expect, test } from "bun:test";
import { fold } from "./fold.ts";
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  findLink,
  isAncestor,
  isLive,
  linksFrom,
  linksTo,
  parentOf,
  sameLink,
} from "./tree.ts";
import type { Draft, FoldedMap } from "./types.ts";

const node = (id: string, parent?: string, type: "node.added" | "node.proposed" = "node.added"): Draft => ({
  type,
  actor: "agent",
  payload: { id, kind: "card", title: id, ...(parent === undefined ? {} : { parent }) },
});
const mapOf = (...drafts: Draft[]): FoldedMap =>
  fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));

// root ─ a ─ a1 ─ g (ghost)
//      └ b
const map = mapOf(
  node("root"),
  node("a", "root"),
  node("a1", "a"),
  node("b", "root"),
  node("g", "a1", "node.proposed"),
  { type: "edge.added", actor: "agent", payload: { from: "b", to: "a", type: "depends_on", why: "w" } },
);

test("a card's parent, children, ancestors and descendants", () => {
  expect(parentOf(map, "a1")).toBe("a");
  expect(parentOf(map, "root")).toBeUndefined();
  expect(childrenOf(map, "root")).toEqual(["a", "b"]);
  expect(ancestorsOf(map, "g")).toEqual(["a1", "a", "root"]);
  expect(descendantsOf(map, "root")).toEqual(["a", "b", "a1", "g"]);
  expect(isAncestor(map, "root", "g")).toBe(true);
  expect(isAncestor(map, "g", "root")).toBe(false);
});

test("a loop in a hand-written map still ends each walk", () => {
  const loop: FoldedMap = {
    ...mapOf(node("x"), node("y")),
    links: [
      { from: "x", to: "y", type: "refines" },
      { from: "y", to: "x", type: "refines" },
    ],
  };
  expect(ancestorsOf(loop, "x")).toEqual(["y"]);
  expect(descendantsOf(loop, "x")).toEqual(["y"]);
});

test("links by end and type", () => {
  expect(linksFrom(map, "b", "depends_on")).toEqual([{ from: "b", to: "a", type: "depends_on", why: "w" }]);
  expect(linksTo(map, "a", "depends_on")).toHaveLength(1);
  expect(findLink(map, { from: "b", to: "a", type: "depends_on" })?.why).toBe("w");
  expect(findLink(map, { from: "a", to: "b", type: "depends_on" })).toBeUndefined();
  expect(sameLink({ from: "a", to: "b", type: "refines" }, { from: "a", to: "b", type: "depends_on" })).toBe(false);
});

test("a link is live when both ends are real, and held while one is a ghost", () => {
  expect(isLive(map, { from: "a1", to: "a", type: "refines" })).toBe(true);
  expect(isLive(map, { from: "g", to: "a1", type: "refines" })).toBe(false);
  expect(isLive(map, { from: "a1", to: "gone", type: "refines" })).toBe(false);
});
