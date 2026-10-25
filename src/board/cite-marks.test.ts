import { expect, test } from "bun:test";
import type { LogEntry } from "../map/fold.ts";
import { markEvents, watchedCards } from "./cite-marks.ts";
import { foldBoard } from "./fold.ts";

const board = (...events: unknown[]) =>
  foldBoard(events.map((event, i): LogEntry => ({ line: i + 1, event })));
const plan = (id: string, cited: Record<string, number>) => ({
  type: "ticket.planned",
  id,
  title: id,
  cited,
});
const move = (id: string, to: string, actor = "loop") => ({
  type: "ticket.moved",
  id,
  to,
  actor,
});

test("only the cards of open tickets are watched", () => {
  const b = board(
    plan("r/01", { a: 1 }),
    plan("r/02", { b: 1 }),
    plan("r/03", { c: 1 }),
    move("r/02", "building", "you"),
    { type: "ticket.archived", id: "r/03" },
  );
  expect([...watchedCards(b)]).toEqual(["a"]);
});

test("a change after the recorded version marks the ticket once, with each kind of change", () => {
  const b = board(plan("r/01", { a: 3 }));
  const changes = [
    { card: "a", kind: "reopened", line: 4 },
    { card: "a", kind: "decided", line: 6 },
    { card: "a", kind: "reopened", line: 7 },
    { card: "z", kind: "reopened", line: 9 },
  ];
  expect(markEvents(b, changes)).toEqual([
    {
      type: "ticket.marked",
      id: "r/01",
      card: "a",
      kind: "reopened, decided",
      version: 7,
    },
  ]);
});

test("a change at or before the recorded version marks nothing", () => {
  const b = board(plan("r/01", { a: 4 }));
  expect(markEvents(b, [{ card: "a", kind: "reopened", line: 4 }])).toEqual([]);
});

test("a change the ticket already carries gives no second event, and a newer one does", () => {
  const marked = board(plan("r/01", { a: 1 }), {
    type: "ticket.marked",
    id: "r/01",
    card: "a",
    kind: "reopened",
    version: 5,
  });
  expect(
    markEvents(marked, [{ card: "a", kind: "reopened", line: 5 }]),
  ).toEqual([]);
  expect(
    markEvents(marked, [{ card: "a", kind: "retitled", line: 8 }]),
  ).toHaveLength(1);
});

test("a ticket in building, merging or done, and an archived one, are never marked", () => {
  const b = board(
    plan("r/01", { a: 1 }),
    plan("r/02", { a: 1 }),
    plan("r/03", { a: 1 }),
    move("r/01", "building", "you"),
    move("r/02", "building", "you"),
    move("r/02", "merging"),
    { type: "ticket.archived", id: "r/03" },
  );
  expect(markEvents(b, [{ card: "a", kind: "reopened", line: 9 }])).toEqual([]);
});
