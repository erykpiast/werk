import { expect, test } from "bun:test";
import { dotOf, LIMIT, type SearchRow, search } from "./card-search";

const row = (id: string, extra: Partial<SearchRow> = {}): SearchRow => ({
  id,
  kind: "card",
  title: `Title of ${id}`,
  why: "",
  status: "open",
  stale: false,
  postponed: false,
  ...extra,
});

const rows = [
  row("vi-werk-stack-notes"),
  row("werk-stack:opt0", { kind: "option", status: null }),
  row("werk-stack"),
  row("werk-stack:opt1", { kind: "option", status: null }),
  row("other", { title: "Runs on Bun", why: "Because of the SEA docs" }),
];

test("a word matches the id, the title and the reason, in map order, ignoring case", () => {
  expect(search(rows, "BUN").map((r) => r.id)).toEqual(["other"]);
  expect(search(rows, "sea docs").map((r) => r.id)).toEqual(["other"]);
  expect(search(rows, "werk-stack").map((r) => r.id)).toEqual([
    "vi-werk-stack-notes",
    "werk-stack:opt0",
    "werk-stack",
    "werk-stack:opt1",
  ]);
});

test("nothing typed, or only a hash, matches nothing", () => {
  expect(search(rows, "")).toEqual([]);
  expect(search(rows, "  ")).toEqual([]);
  expect(search(rows, "#")).toEqual([]);
  expect(search(rows, "qqq")).toEqual([]);
});

test("a leading hash matches ids only: exact first, then prefix, then contains", () => {
  expect(search(rows, "#werk-stack").map((r) => r.id)).toEqual([
    "werk-stack",
    "werk-stack:opt0",
    "werk-stack:opt1",
    "vi-werk-stack-notes",
  ]);
  expect(search(rows, "#bun")).toEqual([]);
  expect(search(rows, "#nothing-like-this")).toEqual([]);
});

test("the list stops at twelve rows", () => {
  const many = Array.from({ length: 30 }, (_, i) => row(`card-${i}`));
  expect(search(many, "card")).toHaveLength(LIMIT);
  expect(search(many, "#card")).toHaveLength(LIMIT);
});

test("a dot takes the status color, red when stale, split when postponed", () => {
  expect(dotOf(row("a", { status: "decided" }))).toEqual({
    color: "decided",
    split: false,
  });
  expect(dotOf(row("a"))).toEqual({ color: "open", split: false });
  expect(dotOf(row("a", { status: "proto" }))).toEqual({
    color: "proto",
    split: false,
  });
  expect(dotOf(row("a", { status: "decided", stale: true }))).toEqual({
    color: "stale",
    split: false,
  });
  expect(dotOf(row("a", { postponed: true }))).toEqual({
    color: "open",
    split: true,
  });
});

test("an option, a source and an excerpt take the color of their kind", () => {
  for (const kind of ["option", "source", "excerpt"]) {
    expect(dotOf(row("x", { kind, status: null }))).toEqual({
      color: kind as "option",
      split: false,
    });
  }
});
