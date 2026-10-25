import { expect, test } from "bun:test";
import { build, decided, link, open, reopen } from "./mark-fixtures.ts";
import { emptyRollup, isPostponed, rollups } from "./rollup.ts";

const child = (id: string, parent: string) =>
  open(id, { parent }).map((e) => e);

test("a card counts itself, a ghost counts in no rollup, and a source is no card", () => {
  const map = build(
    open("root"),
    child("a", "root"),
    {
      type: "node.proposed",
      id: "g",
      kind: "card",
      title: "G",
      status: "open",
      parent: "root",
    },
    {
      type: "node.proposed",
      id: "s",
      kind: "source",
      title: "S",
      status: "open",
    },
  );
  const all = rollups(map);
  expect(all.root).toMatchObject({ cards: 2, open: 2 });
  expect(all.g).toEqual(emptyRollup());
  expect(all.s).toBeUndefined();
});

test("a decided card that waived the option counts as unchallenged, and an open one does not", () => {
  const map = build(
    decided("root"),
    decided("a", { parent: "root" }),
    { type: "node.edited", id: "a", unchallenged: "none weighed" },
    open("b", { parent: "root" }),
    { type: "node.edited", id: "b", unchallenged: "none weighed" },
  );
  expect(rollups(map).root).toMatchObject({ decided: 2, unchallenged: 1 });
});

test("a postponed card and the cards it pauses are paused, and the slice is kept by status", () => {
  const map = build(
    decided("root"),
    decided("b", { parent: "root" }),
    open("a", { parent: "root" }),
    link("a", "b"),
    reopen("b", { reason: "postponed", why: "later" }),
  );
  const root = rollups(map).root;
  expect(root?.paused).toBe(2);
  expect(root?.pausedBy).toEqual({ open: 2, proto: 0, decided: 0 });
  expect(isPostponed(map.nodes.get("a") as never)).toBe(true);
});

test("a stale mark counts as stale and not as paused", () => {
  const map = build(
    decided("b"),
    open("a"),
    link("a", "b"),
    reopen("b", { reason: "invalidated", why: "wrong" }),
  );
  expect(rollups(map).a).toMatchObject({ stale: 1, paused: 0 });
});

test("a card that is both stale and postponed counts as stale only (#pr-wf-paused)", () => {
  const map = build(
    decided("b"),
    decided("c"),
    open("a"),
    link("a", "b"),
    link("a", "c"),
    reopen("b", { reason: "postponed", why: "later" }),
    reopen("c", { reason: "invalidated", why: "wrong" }),
  );
  expect(rollups(map).a).toMatchObject({ stale: 1, paused: 0 });
  expect(isPostponed(map.nodes.get("a") as never)).toBe(false);
});
