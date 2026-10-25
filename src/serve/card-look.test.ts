import { expect, test } from "bun:test";
import type { MapNode } from "../map/fold.ts";
import { cardClasses, unchallengedRing, whoLabel } from "./card-look.ts";

const node = (extra: Partial<MapNode> = {}): MapNode => ({
  id: "a",
  kind: "card",
  title: "A",
  why: "",
  body: "",
  status: "decided",
  who: null,
  proposed: false,
  marks: [],
  noBasis: null,
  unchallenged: null,
  kill: [],
  pending: null,
  ...extra,
});
const mark = (kind: "stale" | "paused" | "postponed") =>
  ({ kind }) as MapNode["marks"][number];

test("the edge carries the status, and staleness is a separate class", () => {
  expect(cardClasses(node())).toBe("card-box status-decided");
  expect(cardClasses(node({ marks: [mark("stale")] }))).toBe(
    "card-box status-decided is-stale",
  );
});

test("a postponed or paused card is striped and keeps its status class", () => {
  for (const kind of ["paused", "postponed"] as const) {
    expect(cardClasses(node({ status: "open", marks: [mark(kind)] }))).toBe(
      "card-box status-open is-postponed",
    );
  }
});

test("a proposed card is marked, and an option takes the option edge", () => {
  expect(cardClasses(node({ proposed: true, kind: "option" }))).toBe(
    "card-box status-option is-proposed",
  );
});

test("the who label reads in words, and the ring shows only when no option was weighed", () => {
  expect(whoLabel(node())).toBeNull();
  expect(whoLabel(node({ who: "you" }))).toBe("you decide");
  expect(whoLabel(node({ who: "me" }))).toBe("I decide");
  expect(whoLabel(node({ who: "prototype" }))).toBe("build it first");
  expect(unchallengedRing(node())).toBe("");
  expect(unchallengedRing(node({ unchallenged: "none" }))).toContain("○");
});
