import { expect, test } from "bun:test";
import { ticket } from "./fixtures.ts";
import { setChecks } from "./set-checks.ts";
import { parseTicket, type Ticket } from "./ticket-parse.ts";

const t = (file: string, parts: Parameters<typeof ticket>[0] = {}) =>
  parseTicket(file, ticket(parts)) as Ticket;
const run = (
  tickets: Ticket[],
  decided: string[] = [],
  stories: string[] = [],
) => setChecks(tickets, decided, stories);
const names = (f: { ticket: string }[]) => f.map((x) => x.ticket);

test("a consistent set passes", () => {
  const set = [
    t("01-a.md", { cites: "#x", stories: "1" }),
    t("02-b.md", { cites: "y", stories: "2", blockedBy: "1" }),
  ];
  expect(run(set, ["x", "y"], ["1", "2"])).toEqual([]);
});

test("an uncited decided card fails on the ticket set line", () => {
  const failures = run([t("01-a.md", { cites: "x" })], ["x", "y"], ["1"]);
  expect(failures).toEqual([
    expect.objectContaining({
      ticket: "ticket set",
      check: "cards-cited",
      message: "no ticket cites: y",
    }),
  ]);
});

test("a missing and an unknown story each fail on the ticket set line", () => {
  const failures = run([t("01-a.md", { stories: "02, 9" })], [], ["2", "3"]);
  expect(failures.map((f) => f.message)).toEqual([
    "no ticket delivers: 3",
    "not in the spec: 9",
  ]);
  expect(names(failures)).toEqual(["ticket set", "ticket set"]);
});

test("a blocker that is not in the set fails the ticket that names it", () => {
  const failures = run(
    [t("01-a.md"), t("02-b.md", { blockedBy: "1, 5" })],
    ["map-reopen"],
    ["1"],
  );
  expect(failures).toEqual([
    expect.objectContaining({
      ticket: "02-b.md",
      check: "blocked_by",
      message: "blocker 5 is not in the set",
    }),
  ]);
});

test("a cycle names the tickets on it and no other", () => {
  const set = [
    t("01-a.md", { blockedBy: "2" }),
    t("02-b.md", { blockedBy: "3" }),
    t("03-c.md", { blockedBy: "1" }),
    t("04-d.md", { blockedBy: "1" }),
    t("05-e.md", { blockedBy: "5" }),
  ];
  expect(names(run(set, ["map-reopen"], ["1"]))).toEqual([
    "01-a.md",
    "02-b.md",
    "03-c.md",
    "05-e.md",
  ]);
});

test("a number held by two files names no blocker, and both files fail", () => {
  const set = [t("01-a.md"), t("1-b.md"), t("02-c.md", { blockedBy: "1" })];
  const failures = run(set, ["map-reopen"], ["1"]);
  expect(names(failures).sort()).toEqual(["01-a.md", "02-c.md", "1-b.md"]);
});

test("a ticket with no number cannot be a blocker", () => {
  const set = [t("a.md"), t("02-b.md", { blockedBy: "1" })];
  expect(names(run(set, ["map-reopen"], ["1"]))).toEqual(["02-b.md"]);
});
