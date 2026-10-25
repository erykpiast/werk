import { expect, test } from "bun:test";
import { ticket } from "./fixtures.ts";
import {
  listOf,
  normalizeNumber,
  parseTicket,
  sectionOf,
  ticketNumber,
} from "./ticket-parse.ts";

test("a correct ticket parses into headers and sections", () => {
  const parsed = parseTicket("01-a.md", ticket());
  expect(parsed?.headers.title?.value).toBe("A person can reopen a card");
  expect(parsed?.headers.touches?.line).toBe(5);
  expect(parsed?.sections.map((s) => s.heading)).toEqual([
    "What to build",
    "Acceptance criteria",
    "Checks",
  ]);
  expect(sectionOf(parsed as never, "Checks")?.body.length).toBeGreaterThan(0);
  expect(sectionOf(parsed as never, "Nope")).toBeUndefined();
});

test("a file with no title line is not a ticket", () => {
  expect(parseTicket("x.md", ticket({ title: null }))).toBeNull();
});

test("a files line is noted, and a repeated header keeps the first", () => {
  const parsed = parseTicket("x.md", `title: A\ntitle: B\nfiles: x\n`);
  expect(parsed?.headers.title?.value).toBe("A");
  expect(parsed?.filesLine).toBe(3);
});

test("a header-looking line inside a section is body text", () => {
  const parsed = parseTicket("x.md", ticket({ what: "cites: nothing" }));
  expect(parsed?.headers.cites?.value).toBe("map-reopen");
});

test("listOf splits on commas and drops empty items", () => {
  expect(listOf(" a, b ,,c")).toEqual(["a", "b", "c"]);
  expect(listOf("")).toEqual([]);
  expect(listOf(undefined)).toEqual([]);
});

test("normalizeNumber drops leading zeros and keeps other text", () => {
  expect(normalizeNumber("007")).toBe("7");
  expect(normalizeNumber("x1")).toBe("x1");
});

test("a ticket number is the leading digits of the file name", () => {
  expect(ticketNumber("02-reopen.md")).toBe("2");
  expect(ticketNumber("reopen.md")).toBeNull();
});
