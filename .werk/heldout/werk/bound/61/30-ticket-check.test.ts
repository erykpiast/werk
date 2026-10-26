import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { type Cli, cli, decided, ghost } from "./cli.ts";

let c: Cli;
beforeEach(() => {
  c = cli();
});
afterEach(() => c.dispose());

const put = (path: string, text: string) => {
  mkdirSync(join(c.project.dir, path, ".."), { recursive: true });
  writeFileSync(join(c.project.dir, path), text);
};
const SPEC2 = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () => c.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lastLine = (s: string) => s.trim().split("\n").at(-1) as string;

/** A root that is open, with decided cards under it: decide everything, then reopen the root. */
function map(extra: unknown[] = [], ids = ["card-a", "card-b"]) {
  c.write([
    ...decided("root", { title: "Root" }),
    ...ids.flatMap((id) => decided(id, { title: `Title ${id}`, parent: "root" })),
    ...extra,
    { type: "node.reopened", id: "root", reason: "rejected" },
  ]);
}

test("30.1 a folder of correct tickets passes", async () => {
  map();
  put("spec.md", SPEC2);
  put("tickets/01-a.md", ticket({ cites: "card-a", stories: "1", touches: "alpha module" }));
  put("tickets/02-b.md", ticket({ cites: "card-b", stories: "2", blockedBy: "1", touches: "beta module" }));
  const r = await check();
  expect(r.stdout.trim().split("\n")).toHaveLength(1);
  expect(lastLine(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  map();
  put("spec.md", SPEC2);
  put("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
  put("tickets/02-b.md", ticket({ cites: "card-b", stories: "2", what: "Line one.\nLine two.\nLine three.\nEdit src/loop.ts now." }));
  put("tickets/03-c.md", ticket({ cites: "card-b", stories: "2", touches: null }));
  const r = await check();
  const out = r.stdout.split("\n");
  const second = out.find((l) => l.startsWith("02-b.md"));
  expect(second).toMatch(/02-b\.md: no-file-paths/);
  expect(second).toContain("src/loop.ts");
  expect(second).toMatch(/line 12/);
  const third = out.find((l) => l.startsWith("03-c.md"));
  expect(third).toMatch(/03-c\.md: shape: touches/);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lastLine(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
  map([ghost("card-ghost", { title: "Ghost", parent: "root", status: "decided" })], ["card-a", "card-b"]);
  put("spec.md", "## User stories\n\n1. As a person, I want a.\n");
  put("tickets/01-a.md", ticket({ cites: "root, card-a", stories: "1" }));
  const r = await check();
  const setLines = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("card-b");
  expect(r.stdout).not.toContain("card-ghost");
  expect(lastLine(r.stdout)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  map([], ["card-a", "card-b", "card-c", "card-d"]);
  put("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
  put("tickets/01-a.md", ticket({ cites: "card-a", stories: "1", touches: "mod a" }));
  put("tickets/02-b.md", ticket({ cites: "card-b", stories: "2", blockedBy: "3", touches: "mod b" }));
  put("tickets/03-c.md", ticket({ cites: "card-c", stories: "3", blockedBy: "2", touches: "mod c" }));
  put("tickets/04-d.md", ticket({ cites: "card-d", stories: "4", blockedBy: "3", touches: "mod d" }));
  const r = await check();
  const lines = r.stdout.split("\n");
  expect(lines.some((l) => /blocked_by/.test(l) && l.includes("02"))).toBe(true);
  expect(lines.some((l) => /blocked_by/.test(l) && l.includes("03"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  map();
  put("spec.md", "# Spec\n\nNo stories here.\n");
  put("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout).not.toMatch(/failures/);
  expect(r.code).toBe(2);
});
