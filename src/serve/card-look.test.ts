import { expect, test } from "bun:test";
import type { MapNode } from "../map/fold.ts";
import {
  cardClasses,
  hasProposal,
  unchallengedRing,
  whoLabel,
} from "./card-look.ts";

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
  removal: null,
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

test("a card that is both stale and postponed shows only as stale", () => {
  expect(
    cardClasses(
      node({ status: "open", marks: [mark("stale"), mark("paused")] }),
    ),
  ).toBe("card-box status-open is-stale");
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

test("a ghost, a pending edit and a pending removal each carry their own class", () => {
  expect(cardClasses(node({ proposed: true }))).toContain("is-proposed");
  const edit = cardClasses(node({ pending: { title: "B" } }));
  expect(edit).toContain("has-edit");
  expect(edit).not.toContain("is-proposed");
  const removal = cardClasses(
    node({ pending: { title: "B" }, removal: { reparent: false } }),
  );
  expect(removal).toContain("is-removal");
  expect(removal).not.toContain("has-edit");
});

test("a proposal is a ghost, an edit or a removal", () => {
  expect(hasProposal(node())).toBe(false);
  expect(hasProposal(node({ proposed: true }))).toBe(true);
  expect(hasProposal(node({ pending: {} }))).toBe(true);
  expect(hasProposal(node({ removal: { reparent: true } }))).toBe(true);
});
