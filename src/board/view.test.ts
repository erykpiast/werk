import { expect, test } from "bun:test";
import type { LogEntry, Obligation } from "../map/fold.ts";
import { foldBoard } from "./fold.ts";
import { boardView, decisionsOf, ticketFields } from "./view.ts";

const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));
const plan = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.planned",
  id,
  title: `Title of ${id}`,
  ...extra,
});

const TICKET = `title: A ticket
cites: #a, b
blocked_by: 1
stories: 4, 7
touches: map view, decision log

## What to build

Make it work.

## Acceptance criteria

- [ ] It works.

## Checks

- \`make test\`
- \`make e2e\`
`;

const obligation = (extra: Partial<Obligation> = {}): Obligation => ({
  id: "o1",
  ticket: "r/01",
  cites: [],
  proposed: [],
  followed: null,
  ...extra,
});

test("a ticket file gives its text from the first section, and its header lists and checks", () => {
  const fields = ticketFields(TICKET);
  expect(fields.text.startsWith("## What to build")).toBe(true);
  expect(fields.cites).toEqual(["a", "b"]);
  expect(fields.stories).toEqual(["4", "7"]);
  expect(fields.touches).toEqual(["map view", "decision log"]);
  expect(fields.checks).toEqual(["make test", "make e2e"]);
});

test("a missing file, or text with no title, has no fields", () => {
  expect(ticketFields(undefined)).toEqual({
    text: "",
    cites: [],
    checks: [],
    stories: [],
    touches: [],
  });
  expect(ticketFields("just words").text).toBe("just words");
});

test("a ticket file with no section has an empty text", () => {
  expect(ticketFields("title: T\ncites: a").text).toBe("");
});

test("decisions: none without an obligation, a card with its state, or no new card with the followed cards", () => {
  const cards = new Map([
    ["c", { title: "Card C", proposed: true }],
    ["d", { title: "Card D", proposed: false }],
  ]);
  const cardOf = (id: string) => cards.get(id) ?? null;
  expect(decisionsOf("r/01", new Map(), cardOf)).toBeNull();
  expect(
    decisionsOf(
      "r/01",
      new Map([
        ["o1", obligation({ proposed: ["c", "d", "gone"] })],
        ["o2", obligation({ id: "o2", proposed: ["c"], followed: ["a"] })],
        ["o3", obligation({ id: "o3", ticket: "r/02", proposed: ["d"] })],
      ]),
      cardOf,
    ),
  ).toEqual({
    cards: [
      { id: "c", title: "Card C", state: "proposal" },
      { id: "d", title: "Card D", state: "accepted" },
      { id: "gone", title: "", state: "gone" },
    ],
    followed: ["a"],
  });
  expect(
    decisionsOf(
      "r/01",
      new Map([
        ["o1", obligation({ followed: ["a", "b"] })],
        ["o2", obligation({ id: "o2", followed: ["a"] })],
      ]),
      cardOf,
    ),
  ).toEqual({ cards: [], followed: ["a", "b"] });
  expect(decisionsOf("r/01", new Map([["o1", obligation()]]), cardOf)).toEqual({
    cards: [],
    followed: [],
  });
});

test("the board view puts each ticket in its column with its counts, and pulses only a live session", () => {
  const board = foldBoard(
    entries(
      plan("r/01"),
      plan("r/02", { blocked_by: ["r/01", "r/09"] }),
      plan("r/03"),
      { type: "ticket.moved", id: "r/03", to: "building" },
      {
        type: "build.started",
        id: "r/03",
        session: "s1",
        pid: 111,
        log: "s1.jsonl",
      },
      { type: "ticket.pass", id: "r/03", n: 1, result: "red" },
      { type: "ticket.pass", id: "r/03", n: 2, result: "red" },
    ),
  );
  const view = (alive: boolean) =>
    boardView({
      board,
      isAlive: () => alive,
      textOf: (id) => (id === "r/01" ? TICKET : undefined),
      obligations: new Map(),
      cardOf: () => null,
    });
  expect(view(true).columns.building.map((t) => t.id)).toEqual(["r/03"]);
  expect(view(true).columns.building[0]).toMatchObject({
    running: true,
    retries: 2,
    openBlockers: 0,
  });
  expect(view(false).columns.building[0]?.running).toBe(false);
  const ready = view(true).columns.ready;
  expect(ready.map((t) => t.id)).toEqual(["r/01", "r/02"]);
  expect(ready[1]).toMatchObject({
    openBlockers: 2,
    running: false,
    blockers: [
      { id: "r/01", done: false },
      { id: "r/09", done: false },
    ],
  });
  expect(ready[0]?.cites).toEqual(["a", "b"]);
  expect(ready[0]?.decisions).toBeNull();
});

test("a blocker that is done is not open", () => {
  const board = foldBoard(
    entries(
      plan("r/01"),
      plan("r/02", { blocked_by: ["r/01"] }),
      { type: "ticket.moved", id: "r/01", to: "building" },
      { type: "ticket.moved", id: "r/01", to: "merging", actor: "loop" },
      { type: "ticket.merge", id: "r/01" },
    ),
  );
  const view = boardView({
    board,
    isAlive: () => true,
    textOf: () => undefined,
    obligations: new Map(),
    cardOf: () => null,
  });
  expect(view.columns.done.map((t) => t.id)).toEqual(["r/01"]);
  expect(view.columns.ready[0]).toMatchObject({
    openBlockers: 0,
    blockers: [{ id: "r/01", done: true }],
  });
});
