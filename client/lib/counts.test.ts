import { expect, test } from "bun:test";
import { type CountRollup, countsOf } from "./counts";

const rollup: CountRollup = {
  cards: 12,
  open: 3,
  proto: 0,
  decided: 9,
  unchallenged: 2,
  stale: 0,
  paused: 1,
};

test("the strip lists the total, the dots, then the rings, and leaves out a zero", () => {
  expect(countsOf(rollup, null).map((c) => [c.kind, c.n])).toEqual([
    ["total", 12],
    ["open", 3],
    ["decided", 9],
    ["unchallenged", 2],
    ["postponed", 1],
  ]);
});

test("each number has a title that names it, and the total names the scope", () => {
  const titles = countsOf(rollup, "pr-logic").map((c) => c.title);
  expect(titles[0]).toBe("12 cards in #pr-logic and everything below it");
  expect(titles).toContain("3 open");
  expect(titles).toContain("2 unchallenged, of 9 decided");
  expect(titles).toContain("1 postponed");
  expect(countsOf(rollup, null)[0]?.title).toBe("12 cards in the whole map");
});

test("a card with no children, or no rollup, shows no counts", () => {
  expect(countsOf({ ...rollup, cards: 1 }, "a")).toEqual([]);
  expect(countsOf(undefined, null)).toEqual([]);
});
