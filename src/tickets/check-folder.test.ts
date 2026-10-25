import { expect, test } from "bun:test";
import { checkTickets, formatVerdict } from "./check-folder.ts";
import { ticket } from "./fixtures.ts";

test("correct tickets give no failure and a count line", () => {
  const verdict = checkTickets(
    [{ name: "01-a.md", text: ticket({ cites: "x" }) }],
    ["x"],
    ["1"],
  );
  expect(verdict.failures).toEqual([]);
  expect(formatVerdict(verdict)).toEqual([
    "1 tickets, 0 own-check failures, 0 failures, 1 decided cards, 1 stories",
  ]);
});

test("a ticket that fails its own checks does not count toward the set", () => {
  const verdict = checkTickets(
    [{ name: "01-a.md", text: ticket({ cites: "x", touches: null }) }],
    ["x"],
    ["1"],
  );
  expect(verdict.ownFailures).toBe(1);
  expect(verdict.failures.map((f) => f.check)).toEqual([
    "shape",
    "cards-cited",
    "stories",
  ]);
});

test("a file with no title gets one title failure and no other check", () => {
  const verdict = checkTickets([{ name: "01-a.md", text: "hello" }], [], []);
  expect(formatVerdict(verdict)[0]).toBe(
    '01-a.md: title: title: the file has no "title:" line, so no other check ran',
  );
});
