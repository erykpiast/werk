import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, decided, ghost, open, seed, werkIn, lines, type Project } from "./support.ts";

let p: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  p = createProject();
  werk = werkIn(p);
});
afterEach(() => p.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const REOPEN = { type: "node.reopened", id: "root", reason: "rejected", at: "2026-10-10T09:00:00.000Z" };
const check = () => werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const spec = (n: number) => `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n`;

test("30.1 a folder of correct tickets passes", async () => {
  seed(p, [decided("root", { title: "Root" }), decided("card-a", { parent: "root" }), decided("card-b", { parent: "root" }), REOPEN]);
  write("spec.md", spec(2));
  write("tickets/01-first.md", ticket({ cites: "card-a", stories: "1", blockedBy: "" }));
  write("tickets/02-second.md", ticket({ cites: "card-b", stories: "2", blockedBy: "1" }));
  const r = await check();
  expect(r.stdout.split("\n").filter((l) => /: (shape|title|blocked_by|cards-cited|stories|no-file-paths)/.test(l))).toEqual([]);
  const ls = lines(r.stdout);
  expect(ls.at(-1)).toMatch(/2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories/);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seed(p, [decided("root", { title: "Root" }), decided("card-a", { parent: "root" }), REOPEN]);
  write("spec.md", spec(1));
  write("tickets/01-ok.md", ticket({ cites: "card-a", stories: "1" }));
  const bad = ticket({ what: "A\nB\nC\nEdit src/loop.ts here." });
  expect(bad.split("\n")[11]).toContain("src/loop.ts");
  write("tickets/02-path.md", bad);
  write("tickets/03-notouch.md", ticket({ touches: null }));
  const r = await check();
  const ls = lines(r.stdout);
  expect(ls.some((l) => l.startsWith("02-path.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && l.includes("line 12"))).toBe(true);
  expect(ls.some((l) => l.startsWith("03-notouch.md") && l.includes("shape") && l.includes("touches"))).toBe(true);
  expect(ls.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  expect(ls.at(-1)).toMatch(/3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  seed(p, [
    decided("root", { title: "Root" }),
    decided("card-cited", { parent: "root" }),
    decided("card-uncited", { parent: "root" }),
    ghost("card-ghost", { parent: "root", status: "decided" }),
  , REOPEN]);
  write("spec.md", spec(2));
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "card-cited", stories: "2" }));
  const r = await check();
  const ls = lines(r.stdout);
  const setLines = ls.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("card-uncited");
  expect(r.stdout).not.toContain("card-ghost");
  expect(ls.at(-1)).toMatch(/\b2 decided cards\b/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seed(p, [decided("root", { title: "Root" }), decided("card-a", { parent: "root" }), REOPEN]);
  write("spec.md", spec(4));
  write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "card-a", stories: "2", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "card-a", stories: "3", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "card-a", stories: "4", blockedBy: "3" }));
  const r = await check();
  const ls = lines(r.stdout);
  expect(ls.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(ls.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(ls.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(ls.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(p, [decided("root", { title: "Root" }), decided("card-a", { parent: "root" }), REOPEN]);
  write("spec.md", "# Spec\n\nJust prose.\n");
  write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
  const r = await check();
  expect(r.stderr).toMatch(/User stories/);
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
