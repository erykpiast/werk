import { expect, test } from "bun:test";
import { checkTickets } from "./check.ts";

const ticket = (cites: string, blockedBy: string, stories: string) => `title: A ticket
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: map view

## What to build

Something works.

## Acceptance criteria

- It works.

## Checks
`;

test("valid tickets pass, and the counts name the tickets, cards and stories", () => {
  const files = [
    { file: "01.md", text: ticket("a", "", "1") },
    { file: "02.md", text: ticket("#b", "1", "2") },
  ];
  expect(checkTickets(files, ["a", "b"], [1, 2])).toEqual({
    failures: [],
    counts: { tickets: 2, ownFailures: 0, failures: 0, cards: 2, stories: 2 },
  });
});

test("a ticket that fails its own checks is left out of the set checks, so its cites and stories do not count", () => {
  const files = [
    { file: "01.md", text: ticket("a", "", "1") },
    { file: "02.md", text: `${ticket("b", "1", "2")}- npm test\n` },
    { file: "03.md", text: ticket("", "2", "") },
  ];
  const result = checkTickets(files, ["a", "b"], [1, 2]);
  expect(result.failures.map((f) => `${f.ticket ?? "ticket set"}: ${f.check}`)).toEqual([
    "02.md: make-targets",
    "ticket set: cards-cited",
    "ticket set: stories",
    "03.md: blocked_by",
  ]);
  expect(result.counts).toEqual({ tickets: 3, ownFailures: 1, failures: 4, cards: 2, stories: 2 });
});
