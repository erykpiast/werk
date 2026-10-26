import { expect, test } from "bun:test";
import { formatCounts, formatFailure, formatReport } from "./report.ts";

test("a failure line names its ticket, check and field, and a set failure names the ticket set", () => {
  expect(formatFailure({ ticket: "01.md", check: "size", field: "file", message: "too long" })).toBe(
    "01.md: size: file: too long",
  );
  expect(formatFailure({ check: "stories", field: "stories", message: "no ticket delivers story 2" })).toBe(
    "ticket set: stories: stories: no ticket delivers story 2",
  );
});

test("the count line counts tickets, own-check failures, failures, decided cards and stories", () => {
  expect(formatCounts({ tickets: 1, ownFailures: 1, failures: 1, cards: 1, stories: 1 })).toBe(
    "1 ticket, 1 own-check failure, 1 failure, 1 decided card, 1 story",
  );
  expect(formatCounts({ tickets: 2, ownFailures: 0, failures: 3, cards: 4, stories: 5 })).toBe(
    "2 tickets, 0 own-check failures, 3 failures, 4 decided cards, 5 stories",
  );
});

test("the report is the failure lines, then the count line", () => {
  const counts = { tickets: 0, ownFailures: 0, failures: 1, cards: 1, stories: 0 };
  expect(formatReport([{ check: "cards-cited", field: "cites", message: "no ticket cites #a" }], counts)).toBe(
    "ticket set: cards-cited: cites: no ticket cites #a\n0 tickets, 0 own-check failures, 1 failure, 1 decided card, 0 stories\n",
  );
});
