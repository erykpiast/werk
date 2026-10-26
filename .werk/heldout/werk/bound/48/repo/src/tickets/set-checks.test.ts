import { expect, test } from "bun:test";
import { type SetTicket, setChecks, ticketNumber } from "./set-checks.ts";

const ticket = (file: string, fields: Partial<SetTicket> = {}): SetTicket => ({
  file,
  cites: [],
  blockedBy: [],
  stories: [],
  ...fields,
});

test("a ticket's number is the number its file name starts with", () => {
  expect(ticketNumber("02-reopen.md")).toBe(2);
  expect(ticketNumber("tickets/10.md")).toBe(10);
  expect(ticketNumber("reopen.md")).toBeUndefined();
});

test("a set that cites every card, delivers every story and blocks in order passes", () => {
  const tickets = [
    ticket("01.md", { cites: ["a"], stories: [1] }),
    ticket("02.md", { cites: ["b"], stories: [2, 1], blockedBy: [1] }),
  ];
  expect(setChecks(tickets, ["a", "b"], [1, 2])).toEqual([]);
});

test("cards-cited lists every card no ticket cites, in one failure of the set", () => {
  expect(setChecks([ticket("01.md", { cites: ["a"] })], ["a", "b", "c"], [])).toEqual([
    { check: "cards-cited", field: "cites", message: "no ticket cites #b, #c" },
  ]);
});

test("stories lists the missing numbers and the unknown numbers as two failures of the set", () => {
  const tickets = [ticket("01.md", { stories: [1, 9] }), ticket("02.md", { stories: [5] })];
  expect(setChecks(tickets, [], [1, 2, 3])).toEqual([
    { check: "stories", field: "stories", message: "no ticket delivers story 2, 3" },
    { check: "stories", field: "stories", message: "a ticket names story 5, 9, which the spec does not have" },
  ]);
});

test("a blocker not in the set names the ticket that names it", () => {
  expect(setChecks([ticket("01.md", { blockedBy: [4] })], [], [])).toEqual([
    {
      ticket: "01.md",
      tickets: ["01.md"],
      check: "blocked_by",
      field: "blocked_by",
      message: "ticket 4 is not in the set",
    },
  ]);
});

test("a blocker cycle is one failure that names every ticket on it, and a ticket that blocks itself is a cycle", () => {
  const tickets = [
    ticket("03.md", { blockedBy: [2] }),
    ticket("02.md", { blockedBy: [4] }),
    ticket("04.md", { blockedBy: [3] }),
    ticket("05.md", { blockedBy: [5] }),
    ticket("06.md", { blockedBy: [2] }),
    ticket("notes.md"),
  ];
  expect(setChecks(tickets, [], [])).toEqual([
    {
      ticket: "02.md",
      tickets: ["02.md", "03.md", "04.md"],
      check: "blocked_by",
      field: "blocked_by",
      message: "a blocked_by cycle: 02.md, 03.md, 04.md",
    },
    {
      ticket: "05.md",
      tickets: ["05.md"],
      check: "blocked_by",
      field: "blocked_by",
      message: "a blocked_by cycle: 05.md",
    },
  ]);
});
