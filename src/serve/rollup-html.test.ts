import { expect, test } from "bun:test";
import { emptyRollup, type Rollup } from "../map/rollup.ts";
import {
  cardsBelow,
  rollupBar,
  rollupFlags,
  rollupLine,
} from "./rollup-html.ts";

const rollup = (extra: Partial<Rollup>): Rollup => ({
  ...emptyRollup(),
  ...extra,
});

test("a leaf has no bar, no line and no chips", () => {
  const leaf = rollup({ cards: 1, open: 1 });
  expect(cardsBelow(leaf)).toBe(0);
  expect(rollupBar(leaf)).toBe("");
  expect(rollupLine(leaf)).toBe("");
  expect(rollupFlags(leaf)).toBe("");
});

test("the bar has the widths of decided, open and proto, with the postponed part hatched", () => {
  const bar = rollupBar(
    rollup({
      cards: 4,
      decided: 2,
      open: 1,
      proto: 1,
      pausedBy: { open: 1, proto: 0, decided: 0 },
    }),
  );
  expect(bar).toContain('seg-decided" style="width:50.00%"');
  expect(bar).toContain('seg-open seg-postponed" style="width:25.00%"');
  expect(bar).toContain('seg-proto" style="width:25.00%"');
  expect(bar).not.toContain('seg-open" style');
});

test("the line names its scope and total, then the dots, then the rings, and leaves out zeros", () => {
  const line = rollupLine(
    rollup({
      cards: 5,
      open: 2,
      decided: 3,
      unchallenged: 1,
      stale: 1,
      paused: 1,
    }),
  );
  expect(line).toContain("this card and everything below it, 5 cards");
  const order = [
    "2 open",
    "3 decided",
    "1 unchallenged",
    "1 stale",
    "1 paused",
  ];
  const at = order.map((text) => line.indexOf(text));
  expect(at.every((n) => n > 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(line).not.toContain("proto");
});

test("the chips give a ratio for unchallenged and a count for stale, and stay out of the line", () => {
  const flags = rollupFlags(
    rollup({ cards: 4, decided: 3, unchallenged: 2, stale: 1 }),
  );
  expect(flags).toContain("2 of 3 decided had no option presented");
  expect(flags).toContain("1 stale");
  expect(rollupFlags(rollup({ cards: 2, open: 2 }))).toBe("");
});
