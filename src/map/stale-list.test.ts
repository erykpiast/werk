import { describe, expect, test } from "bun:test";
import {
  build,
  decide,
  decided,
  ghost,
  link,
  open,
  reopen,
  review,
} from "./mark-fixtures.ts";
import { listMarked, renderMarked } from "./stale-list.ts";

const ids = (
  map: ReturnType<typeof build>,
  root: string | null = null,
  kind = null as never,
) =>
  listMarked(map, root, kind).map((entry) => `${entry.kind}:${entry.node.id}`);

describe("the list", () => {
  test("is empty and says so when nothing is marked", () => {
    const map = build(decided("a"));
    expect(listMarked(map, null, null)).toEqual([]);
    expect(renderMarked([])).toBe("nothing is marked");
  });

  test("prints a basis before the card that depends on it", () => {
    // The map order puts z first. z waits on y, which is stale.
    const map = build(
      decided("x"),
      decided("y"),
      ...open("z"),
      link("y", "x"),
      link("z", "y"),
      reopen("x"),
      decide("x"),
    );
    expect(ids(map)).toEqual(["stale:y", "waiting:z"]);
    const reversed = build(
      decided("x"),
      ...open("z"),
      decided("y"),
      link("y", "x"),
      link("z", "y"),
      reopen("x"),
      decide("x"),
    );
    expect(ids(reversed)).toEqual(["stale:y", "waiting:z"]);
  });

  test("orders a marked basis first even when the card comes first in the map", () => {
    const map = build(
      decided("x"),
      decided("a"),
      decided("b"),
      link("a", "b"),
      link("b", "x"),
      reopen("x"),
      decide("x"),
      reopen("b"),
      decide("b"),
    );
    expect(ids(map)).toEqual(["stale:b", "stale:a"]);
  });

  test("a card linked after the change waits and carries no mark", () => {
    const map = build(
      decided("x"),
      decided("y"),
      link("y", "x"),
      reopen("x"),
      ...open("n"),
      link("n", "y"),
    );
    expect(ids(map)).toEqual(["stale:y", "waiting:n"]);
    expect(renderMarked(listMarked(map, null, "waiting"))).toContain(
      "waits for #y (stale)",
    );
  });

  test("a card on an open basis waits, naming the basis", () => {
    const map = build(...open("p"), ...open("c", { parent: "p" }));
    const text = renderMarked(listMarked(map, null, null));
    expect(text).toContain("waiting  c");
    expect(text).toContain("waits for #p (open)");
  });

  test("paused and postponed cards are listed as paused", () => {
    const map = build(
      decided("p"),
      decided("q"),
      link("q", "p"),
      reopen("p", { reason: "postponed", why: "later" }),
    );
    expect(ids(map, null, "paused" as never)).toEqual(["paused:p", "paused:q"]);
    expect(renderMarked(listMarked(map, null, "paused"))).toContain(
      "PAUSED from #p, postponed on 2026-10-10",
    );
  });

  test("a kind filter keeps one kind", () => {
    const map = build(
      decided("x"),
      decided("y"),
      link("y", "x"),
      reopen("x"),
      ...open("n"),
      link("n", "y"),
    );
    expect(ids(map, null, "stale" as never)).toEqual(["stale:y"]);
  });

  test("a subtree filter keeps the card and its refines subtree", () => {
    const map = build(
      decided("x"),
      decided("sub"),
      decided("k", { parent: "sub" }),
      decided("other"),
      link("k", "x"),
      link("other", "x"),
      reopen("x"),
    );
    expect(ids(map, "sub")).toEqual(["stale:k"]);
    expect(ids(map)).toContain("stale:other");
  });

  test("a ghost and an option are never listed, and a cleared card is not", () => {
    const map = build(
      decided("x"),
      decided("y"),
      link("y", "x"),
      ghost("g", { parent: "x" }),
      reopen("x"),
      decide("x"),
      review("y", { confirmed: ["x"] }),
    );
    expect(ids(map)).toEqual([]);
  });
});
