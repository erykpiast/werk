import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../map/fold.ts";
import { decided, link, open, reopen } from "../map/mark-fixtures.ts";
import { citedChanges, versionsOf } from "./cited-changes.ts";

const entries = (...events: unknown[]): LogEntry[] =>
  events.flat().map((event, i) => ({ line: i + 1, event }));

/** The counted changes after the first `born` lines, as "line card: kind". The setup lines count nothing. */
const after = (born: number, list: unknown[], ...cards: string[]) =>
  citedChanges(entries(...list), new Set(cards))
    .filter((c) => c.line > born)
    .map((c) => `${c.line} ${c.card}: ${c.kind}`);

const A = decided("a", { body: "One." });
const edit = (fields: Record<string, unknown>) => [
  {
    type: "change.proposed",
    id: "a",
    ...fields,
    ops: [{ tag: "elaborated", old: "One.", new: "One, more." }],
  },
  { type: "node.accepted", id: "a", actor: "you" },
];

describe("which events count", () => {
  test("a card that is born and accepted counts nothing, and deciding it counts as decided", () => {
    expect(after(0, [open("a")], "a")).toEqual([]);
    expect(after(0, [A], "a")).toEqual([`${A.length} a: decided`]);
  });

  test("a reopen counts as reopened, and deciding the card again counts as decided", () => {
    const n = A.length;
    expect(
      after(n, [A, reopen("a"), { type: "node.decided", id: "a" }], "a"),
    ).toEqual([`${n + 1} a: reopened`, `${n + 2} a: decided`]);
  });

  test("a note counts nothing", () => {
    const note = { type: "note.added", id: "a", text: "hello", who: "you" };
    expect(after(A.length, [A, note], "a")).toEqual([]);
  });

  test("an event the fold refuses counts nothing, and so does a line that is not JSON", () => {
    const list: LogEntry[] = [
      ...entries(A),
      { line: 90, event: null, error: "bad" },
      { line: 91, event: { type: "node.reopened", id: "nothing" } },
    ];
    expect(
      citedChanges(list, new Set(["a"])).filter((c) => c.line > A.length),
    ).toEqual([]);
  });

  test("an accepted change counts for each of the words that moved", () => {
    const list = [A, reopen("a"), edit({ title: "New", why: "New why" })];
    const text = after(A.length, list, "a").join("\n");
    expect(text).toContain("title changed");
    expect(text).toContain("why changed");
    expect(text).toContain("body changed");
    expect(text).toContain("reopened");
  });

  test("a removal counts as removed and a restore as restored", () => {
    const n = A.length;
    const list = [
      A,
      { type: "node.removed", id: "a" },
      { type: "node.restored", id: "a" },
    ];
    expect(after(n, list, "a")).toEqual([
      `${n + 1} a: removed`,
      `${n + 2} a: restored`,
    ]);
  });

  test("a depends_on edge counts for both its ends, and a refines edge counts for neither", () => {
    const base = [A, decided("b"), decided("c")];
    const n = entries(...base).length;
    const list = [...base, link("b", "a"), link("c", "a", "refines")];
    expect(after(n, list, "a", "b", "c")).toEqual([
      `${n + 1} a: depends_on edge added`,
      `${n + 1} b: depends_on edge added`,
    ]);
  });

  test("a card that is a ghost counts nothing when a person accepts it", () => {
    expect(after(0, [open("g")], "g")).toEqual([]);
  });
});

describe("a stale mark", () => {
  test("a reopen of a card marks the card that depends on it", () => {
    const base = [A, decided("b"), link("b", "a")];
    const n = entries(...base).length;
    expect(after(n, [...base, reopen("a")], "b")).toEqual([
      `${n + 1} b: marked stale`,
    ]);
  });

  test("a postponed reopen marks the card paused", () => {
    const base = [A, decided("b"), link("b", "a")];
    const list = [...base, reopen("a", { reason: "postponed" })];
    expect(after(entries(...base).length, list, "b")[0]).toContain(
      "marked paused",
    );
  });

  test("no watched card, no work", () => {
    expect(citedChanges(entries(A), new Set())).toEqual([]);
  });
});

describe("versions", () => {
  test("a card's version is the line of its latest change, and 0 when none changed", () => {
    const changes = [
      { card: "a", kind: "x", line: 3 },
      { card: "a", kind: "y", line: 7 },
      { card: "b", kind: "x", line: 5 },
    ];
    expect(versionsOf(changes, ["a", "c"])).toEqual({ a: 7, c: 0 });
  });
});
