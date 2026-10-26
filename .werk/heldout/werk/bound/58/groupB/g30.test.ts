import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost } from "../../src/map/mark-fixtures.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { make, SLOW, seed } from "./helper.ts";

let t: ReturnType<typeof make>;
beforeEach(() => {
  t = make();
});
afterEach(() => t.project.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(t.project.dir, path, ".."), { recursive: true });
  writeFileSync(join(t.project.dir, path), text);
};
const REOPEN = {
  type: "node.reopened",
  id: "root",
  reason: "postponed",
  at: "2026-10-10T09:00:00.000Z",
};
const SPEC2 = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () =>
  t.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

/** A root that is open again, with decided cards under it (a decided card needs a decided basis first). */
function cards(...ids: string[]) {
  seed(t.project, decided("root"), ...ids.map((id) => decided(id, { parent: "root" })), REOPEN);
}

test("30.1 a folder of correct tickets passes", async () => {
  cards("a", "b");
  write("spec.md", SPEC2);
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe(
    "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
  );
  expect(r.code).toBe(0);
}, SLOW);

test("30.2 own-check failures name ticket, check and field", async () => {
  cards("a", "b", "c");
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n");
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({ cites: "b", stories: "2", what: "First line.\n\n\nEdit src/loop.ts now." }),
  );
  write("tickets/03-c.md", ticket({ cites: "c", stories: "3", touches: null }));
  const r = await check();
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-b.md"));
  expect(second).toContain("src/loop.ts");
  expect(second).toContain("line 12");
  expect(second).toMatch(/path/);
  const third = out.find((l) => l.startsWith("03-c.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
}, SLOW);

test("30.3 an uncited decided card fails the set; a ghost does not count", async () => {
  seed(
    t.project,
    decided("root"),
    decided("a", { parent: "root" }),
    decided("b", { parent: "root" }),
    ghost("gh", { parent: "root", status: "decided" }),
    REOPEN,
  );
  write("spec.md", "## User stories\n\n1. a\n2. b\n");
  write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "root", stories: "2" }));
  const r = await check();
  const out = lines(r.stdout);
  const setLines = out.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("b");
  expect(r.stdout).not.toContain("gh");
  expect(out.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
}, SLOW);

test("30.4 a blocked_by cycle names only the tickets on it", async () => {
  cards("a", "b");
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
  write("tickets/01-a.md", ticket({ cites: "a, b", stories: "1" }));
  write("tickets/02-b.md", ticket({ stories: "2", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ stories: "3", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ stories: "4", blockedBy: "3" }));
  const r = await check();
  const out = lines(r.stdout);
  const bl = (n: string) => out.filter((l) => l.startsWith(`${n}`) && l.includes("blocked_by"));
  expect(bl("02-b.md")).toHaveLength(1);
  expect(bl("03-c.md")).toHaveLength(1);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
}, SLOW);

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  cards("a");
  write("spec.md", "# Spec\n\nNothing here.\n");
  write("tickets/01-a.md", ticket({ cites: "a" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout).toBe("");
  expect(r.code).toBe(2);
}, SLOW);
