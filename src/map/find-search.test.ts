import { describe, expect, test } from "bun:test";
import { findOpen, renderIndex, searchCards } from "./find-search.ts";
import {
  build,
  decide,
  decided,
  ghost,
  link,
  open,
  reopen,
} from "./mark-fixtures.ts";

const names = (nodes: { id: string }[]) => nodes.map((node) => node.id);

describe("find", () => {
  test("lists open and proto cards breadth first and leaves out the rest", () => {
    const map = build(
      open("top"),
      open("a", { parent: "top" }),
      [...open("b", { parent: "top", status: "proto" })],
      open("c", { parent: "a" }),
      ghost("g", { parent: "top" }),
      decided("dec"),
    );
    expect(names(findOpen(map, "top"))).toEqual(["top", "a", "b", "c"]);
    expect(names(findOpen(map, null))).toEqual(["top", "a", "b", "c"]);
    expect(names(findOpen(map, "dec"))).toEqual([]);
  });

  test("leaves out paused, stale and postponed cards, and lists a rejected one", () => {
    const map = build(
      decided("base"),
      decided("dep"),
      link("dep", "base"),
      open("top"),
      open("x", { parent: "top" }),
      open("y", { parent: "top" }),
      reopen("base", { reason: "rejected" }),
    );
    // base is reopened as rejected: listed; dep is stale: left out.
    expect(names(findOpen(map, null))).toContain("base");
    expect(names(findOpen(map, null))).not.toContain("dep");
    const postponed = build(
      decided("p"),
      decided("q"),
      link("q", "p"),
      reopen("p", { reason: "postponed" }),
    );
    expect(findOpen(postponed, null)).toEqual([]);
  });
});

describe("search", () => {
  const map = build(
    decided("a", { title: "Seat price", why: "seat seat" }),
    decided("b", { title: "Seat plan", why: "price" }),
    decided("c", { title: "Other" }),
    open("d", { title: "Seat price draft" }),
    ghost("e", { title: "seat price ghost" }),
    open("c:opt0", { kind: "option", title: "x", why: "too rare lemon" }),
    link("c:opt0", "c", "alternative_to"),
  );

  test("with no term it is the index of decided cards", () => {
    const found = searchCards(map, { terms: [], status: null, under: null });
    expect(names(found)).toEqual(["a", "b", "c"]);
    expect(renderIndex(found).split("\n")).toHaveLength(3);
  });

  test("two terms return the cards that hold both, most hits first", () => {
    const found = searchCards(map, {
      terms: ["SEAT", "price"],
      status: null,
      under: null,
    });
    expect(names(found)).toEqual(["a", "b", "d"]);
  });

  test("an empty term is dropped, so it ends and acts as no term", () => {
    const found = searchCards(map, { terms: [""], status: null, under: null });
    expect(names(found)).toEqual(["a", "b", "c"]);
    const mixed = searchCards(map, {
      terms: ["", "lemon"],
      status: null,
      under: null,
    });
    expect(names(mixed)).toEqual(["c"]);
  });

  test("a status filter narrows the result", () => {
    const found = searchCards(map, {
      terms: ["seat"],
      status: "open",
      under: null,
    });
    expect(names(found)).toEqual(["d"]);
  });

  test("a term in an option's why-not finds the card", () => {
    const found = searchCards(map, {
      terms: ["lemon"],
      status: null,
      under: null,
    });
    expect(names(found)).toEqual(["c"]);
  });

  test("the subtree filter keeps only the subtree", () => {
    const tree = build(
      decided("r"),
      decided("k", { parent: "r", title: "needle" }),
      decided("o", { title: "needle" }),
    );
    expect(
      names(searchCards(tree, { terms: ["needle"], status: null, under: "r" })),
    ).toEqual(["k"]);
  });
});
