import { expect, test } from "bun:test";
import { openCardId, subCardIds } from "./scope";

const card = (id: string) => ({ id, kind: "card" });
const refines = (from: string, to: string) => ({ from, to, type: "refines" });

test("the card with the id root is opened", () => {
  const shape = { nodes: [card("a"), card("root")], edges: [] };
  expect(openCardId(shape)).toBe("root");
});

test("with no root card, the first card that refines no other card is opened", () => {
  const shape = {
    nodes: [card("child"), card("top"), card("other")],
    edges: [refines("child", "top")],
  };
  expect(openCardId(shape)).toBe("top");
});

test("options and sources are never opened, and an empty map opens nothing", () => {
  expect(
    openCardId({ nodes: [{ id: "x:opt0", kind: "option" }], edges: [] }),
  ).toBeNull();
  expect(openCardId({ nodes: [], edges: [] })).toBeNull();
});

test("the sub-cards are the cards that refine the open card, in shape order", () => {
  const shape = {
    nodes: [card("root"), card("a"), card("b"), card("c")],
    edges: [
      refines("b", "root"),
      refines("c", "a"),
      { from: "a", to: "root", type: "depends_on" },
      refines("a", "root"),
    ],
  };
  expect(subCardIds(shape, "root")).toEqual(["b", "a"]);
  expect(subCardIds(shape, "c")).toEqual([]);
});
