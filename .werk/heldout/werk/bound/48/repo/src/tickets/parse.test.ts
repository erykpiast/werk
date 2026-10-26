import { expect, test } from "bun:test";
import { listOf, parseTicket, sectionOf } from "./parse.ts";

const TICKET = `title: A person can reopen a card
cites: map-reopen, #map-stale
blocked_by: 2
stories: 4, 7
touches: map view

## What to build

A person presses reopen.

## Acceptance criteria

- [ ] A reopened card shows as open.

## Checks

- \`make test\`
`;

test("the header lines are read with their line numbers, and each section with the lines below its heading", () => {
  const ticket = parseTicket(TICKET);
  expect(ticket.headers).toEqual({
    title: { line: 1, value: "A person can reopen a card" },
    cites: { line: 2, value: "map-reopen, #map-stale" },
    blocked_by: { line: 3, value: "2" },
    stories: { line: 4, value: "4, 7" },
    touches: { line: 5, value: "map view" },
  });
  expect(ticket.sections.map((section) => [section.name, section.line])).toEqual([
    ["What to build", 7],
    ["Acceptance criteria", 11],
    ["Checks", 15],
  ]);
  expect(sectionOf(ticket, "What to build")?.lines.map((line) => line.text)).toEqual([
    "",
    "A person presses reopen.",
    "",
  ]);
  expect(sectionOf(ticket, "Notes")).toBeUndefined();
});

test("a header-like line below the first heading is section text, and only the first header line of a name counts", () => {
  const ticket = parseTicket("title: one\ntitle: two\n## What to build\ncites: x\n");
  expect(ticket.headers).toEqual({ title: { line: 1, value: "one" } });
  expect(sectionOf(ticket, "What to build")?.lines).toEqual([
    { n: 4, text: "cites: x" },
    { n: 5, text: "" },
  ]);
});

test("a deeper heading stays inside its section, and Windows line ends read the same", () => {
  const ticket = parseTicket("title: t\r\n## Checks\r\n### Notes\r\n");
  expect(ticket.headers.title).toEqual({ line: 1, value: "t" });
  expect(ticket.sections).toHaveLength(1);
  expect(ticket.sections[0]?.lines.map((line) => line.text)).toEqual(["### Notes", ""]);
});

test("a list value splits on commas and drops the empty entries", () => {
  expect(listOf(" a , b,, c ")).toEqual(["a", "b", "c"]);
  expect(listOf("")).toEqual([]);
  expect(listOf(undefined)).toEqual([]);
});
