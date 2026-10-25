import { expect, test } from "bun:test";
import { checkTickets } from "../tickets/check-folder.ts";
import { ticket } from "../tickets/fixtures.ts";
import { planTickets } from "./ticket-events.ts";

const plan = (
  files: { name: string; text: string }[],
  decided = ["map-reopen"],
) => planTickets("app", files, checkTickets(files, decided, ["1"]));

test("a valid ticket is planned under the plan id and its two-digit number", () => {
  const result = plan([{ name: "1-a.md", text: ticket() }]);
  expect(result.planned).toEqual([
    {
      type: "ticket.planned",
      id: "app/01",
      title: "A person can reopen a card",
      blocked_by: [],
      cited: { "map-reopen": 0 },
    },
  ]);
  expect(result.unplanned).toEqual([]);
});

test("a ticket that fails its own checks gets no event", () => {
  const result = plan([
    { name: "01-a.md", text: ticket() },
    { name: "02-b.md", text: ticket({ what: "Edit src/loop.ts." }) },
  ]);
  expect(result.planned.map((t) => t.id)).toEqual(["app/01"]);
});

test("a ticket that names a missing blocker is planned with the reason, and keeps only real blockers", () => {
  const result = plan([
    { name: "01-a.md", text: ticket() },
    { name: "02-b.md", text: ticket({ blockedBy: "1, 9", cites: "" }) },
  ]);
  const second = result.planned[1];
  expect(second?.blocked_by).toEqual(["app/01"]);
  expect(second?.reason).toContain("blocker 9 is not in the set");
  expect(result.planned[0]?.reason).toBeUndefined();
});

test("a file with no usable number is not planned, and two files with one number are not planned", () => {
  const result = plan([
    { name: "a.md", text: ticket() },
    { name: "100-b.md", text: ticket() },
    { name: "03-c.md", text: ticket() },
    { name: "3-d.md", text: ticket() },
  ]);
  expect(result.planned).toEqual([]);
  expect(result.unplanned).toHaveLength(3);
});

test("planned tickets come in number order", () => {
  const result = plan([
    { name: "02-b.md", text: ticket() },
    { name: "01-a.md", text: ticket() },
  ]);
  expect(result.planned.map((t) => t.id)).toEqual(["app/01", "app/02"]);
});
