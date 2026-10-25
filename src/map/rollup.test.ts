import { describe, expect, test } from "bun:test";
import { applyEvent, emptyMap, type FoldedMap } from "./fold.ts";
import { rollup, rollupText } from "./rollup.ts";

function tree(): FoldedMap {
  const map = emptyMap();
  const add = (id: string, status: string, parent?: string) => {
    applyEvent(map, {
      type: "node.proposed",
      id,
      kind: "card",
      title: id,
      status,
      parent,
    });
    const n = map.nodes.get(id);
    if (n) n.proposed = false;
    const held = map.ghostEdges.splice(0);
    map.edges.push(...held);
  };
  add("price", "decided");
  add("seats", "open", "price");
  add("tiers", "decided", "price");
  const tiers = map.nodes.get("tiers");
  tiers?.marks.push({ kind: "stale", trace: "t" });
  return map;
}

describe("rollup", () => {
  test("counts the card and its refines subtree", () => {
    expect(rollup(tree(), "price")).toEqual({
      cards: 3,
      open: 1,
      proto: 0,
      decided: 2,
      unchallenged: 0,
      stale: 1,
    });
  });

  test("a ghost and an unknown card have none", () => {
    const map = tree();
    applyEvent(map, {
      type: "node.proposed",
      id: "g",
      kind: "card",
      title: "g",
      status: "open",
    });
    expect(rollup(map, "g")).toBeNull();
    expect(rollup(map, "nope")).toBeNull();
  });

  test("a ghost child is in no count", () => {
    const map = tree();
    applyEvent(map, {
      type: "node.proposed",
      id: "g",
      kind: "card",
      title: "g",
      status: "open",
      parent: "price",
    });
    expect(rollup(map, "price")?.cards).toBe(3);
  });

  test("the text names the card count and only the non-zero counts", () => {
    const r = rollup(tree(), "price");
    expect(r && rollupText(r)).toBe("3 cards, 1 open, 2 decided, 1 stale");
    const one = rollup(tree(), "seats");
    expect(one && rollupText(one)).toBe("1 card, 1 open");
  });
});
