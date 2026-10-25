import { expect, test } from "bun:test";
import { fold } from "../map/fold.ts";
import { decidedUnder } from "./decided-cards.ts";

let line = 0;
const node = (
  id: string,
  parent: string | null,
  status: string,
  kind = "card",
) => ({
  line: ++line,
  event: {
    type: "node.proposed",
    id,
    kind,
    title: id,
    status,
    ...(parent ? { parent } : {}),
  },
});
const accept = (id: string) => ({
  line: ++line,
  event: { type: "node.accepted", id, actor: "you" },
});

test("the root and its decided accepted descendants count, at any depth", () => {
  const map = fold([
    node("root", null, "decided"),
    accept("root"),
    node("a", "root", "decided"),
    node("b", "a", "decided"),
    node("open", "root", "open"),
    node("other", null, "decided"),
    accept("a"),
    accept("b"),
    accept("open"),
    accept("other"),
  ]);
  expect(decidedUnder(map, "root").sort()).toEqual(["a", "b", "root"]);
});

test("a ghost that carries the status decided does not count", () => {
  const map = fold([
    node("root", null, "open"),
    accept("root"),
    node("ghost", "root", "decided"),
  ]);
  expect(decidedUnder(map, "root")).toEqual([]);
});

test("an option under the root is not a card", () => {
  const map = fold([
    node("root", null, "decided"),
    accept("root"),
    node("o", null, "decided", "option"),
  ]);
  expect(decidedUnder(map, "root")).toEqual(["root"]);
});

test("a chain that loops back never counts as under the root", () => {
  const map = fold([node("x", null, "decided"), accept("x")]);
  map.parents.set("x", "y");
  map.parents.set("y", "x");
  expect(decidedUnder(map, "root")).toEqual([]);
});
