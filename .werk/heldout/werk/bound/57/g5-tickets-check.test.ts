import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { card, ghostDecided, reopenRoot, seedMap, werk, write } from "./g5-helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const check = (spec = "spec.md") =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", spec);
const SPEC = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";

test("30.1 a folder of correct tickets passes", async () => {
  seedMap(p, ...card("root"), ...card("c1", "root"), ...card("c2", "root"), reopenRoot);
  write(p, "spec.md", SPEC);
  write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
  write(p, "tickets/02-b.md", ticket({ cites: "c2", stories: "2", blockedBy: "1" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name ticket, check and field", async () => {
  seedMap(p, ...card("root"), ...card("c1", "root"), reopenRoot);
  write(p, "spec.md", SPEC);
  write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1,2" }));
  write(p, "tickets/02-b.md", ticket({ what: "one\ntwo\nthree\nEdit src/loop.ts now." }));
  write(p, "tickets/03-c.md", ticket({ touches: null }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 12"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("shape") && l.includes("touches"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.at(-1)).toContain("3 tickets, 2 own-check failures");
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  seedMap(p, ...card("root"), ...card("c1", "root"), ...card("c2", "root"), ghostDecided("ghost", "root"), reopenRoot);
  write(p, "spec.md", SPEC);
  write(p, "tickets/01-a.md", ticket({ cites: "root, c1", stories: "1" }));
  write(p, "tickets/02-b.md", ticket({ cites: "root, c1", stories: "2" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  const set = lines.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("c2");
  expect(lines.some((l) => l.includes("ghost"))).toBe(false);
  expect(lines.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only tickets on the cycle", async () => {
  seedMap(p, ...card("root"), ...card("c1", "root"), reopenRoot);
  write(p, "spec.md", "## User stories\n\n1. a\n");
  write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
  write(p, "tickets/02-b.md", ticket({ blockedBy: "3" }));
  write(p, "tickets/03-c.md", ticket({ blockedBy: "2" }));
  write(p, "tickets/04-d.md", ticket({ blockedBy: "3" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md") || l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading exits 2", async () => {
  seedMap(p, ...card("root"), ...card("c1", "root"), reopenRoot);
  write(p, "spec.md", "# Spec\n\nNothing here.\n");
  write(p, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout).toBe("");
  expect(r.code).toBe(2);
});
