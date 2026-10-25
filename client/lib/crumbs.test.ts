import { expect, test } from "bun:test";
import { lineOf, pathTo, WIDE_PANE } from "./crumbs";

const rows = [
  { id: "root", title: "Root", parent: null },
  { id: "a", title: "A", parent: "root" },
  { id: "b", title: "B", parent: "a" },
  { id: "c", title: "C", parent: "b" },
];

test("the path runs from the root to the card", () => {
  expect(pathTo(rows, "c").map((c) => c.id)).toEqual(["root", "a", "b", "c"]);
  expect(pathTo(rows, "root").map((c) => c.id)).toEqual(["root"]);
});

test("a card the map lacks, or no card, has no path", () => {
  expect(pathTo(rows, "nobody")).toEqual([]);
  expect(pathTo(rows, null)).toEqual([]);
});

test("a loop in the parents ends the path instead of hanging", () => {
  const loop = [
    { id: "x", title: "X", parent: "y" },
    { id: "y", title: "Y", parent: "x" },
  ];
  expect(pathTo(loop, "x").map((c) => c.id)).toEqual(["y", "x"]);
});

test("a narrow pane shows two segments, and a wide pane shows three", () => {
  const path = pathTo(rows, "c");
  const narrow = lineOf(path, WIDE_PANE - 1);
  expect(narrow.shown.map((c) => c.id)).toEqual(["b", "c"]);
  expect(narrow.cut).toBe(true);
  expect(narrow.overlay).toBe(true);
  const wide = lineOf(path, WIDE_PANE);
  expect(wide.shown.map((c) => c.id)).toEqual(["a", "b", "c"]);
  expect(wide.cut).toBe(true);
});

test("a path of two segments or fewer has no overlay and no ellipsis", () => {
  const line = lineOf(pathTo(rows, "a"), 300);
  expect(line.shown.map((c) => c.id)).toEqual(["root", "a"]);
  expect(line.cut).toBe(false);
  expect(line.overlay).toBe(false);
  expect(lineOf(pathTo(rows, "b"), WIDE_PANE)).toMatchObject({
    cut: false,
    overlay: true,
  });
});
