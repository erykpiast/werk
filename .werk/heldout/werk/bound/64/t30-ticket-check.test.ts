import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { open } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, type Project, realDecided, seed, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const write = (path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const check = () =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const SPEC = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, story ${i + 1}.`).join("\n")}\n\n## Other\n`;
const twoCards = () =>
  seed(p, open("root", { title: "Root" }), realDecided("a", { parent: "root" }), realDecided("b", { parent: "root" }));
const lines = (s: string) => s.trim().split("\n");

test("30.1 a folder of correct tickets passes", async () => {
  twoCards();
  write("spec.md", SPEC(2));
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const l = lines(r.stdout);
  expect(l.length).toBe(1);
  expect(l.at(-1)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name ticket, check and field", async () => {
  twoCards();
  write("spec.md", SPEC(1));
  write("tickets/01-a.md", ticket({ cites: "a, b", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({ what: "Line a.\nLine b.\nLine c.\nSee src/loop.ts here." }),
  );
  write("tickets/03-c.md", ticket({ touches: null }));
  const r = await check();
  expect(r.stdout).toMatch(/02-b\.md: no-file-paths: .*src\/loop\.ts \(line 12\)/);
  expect(r.stdout).toMatch(/03-c\.md: shape: touches/);
  expect(r.stdout).not.toMatch(/01-a\.md/);
  expect(lines(r.stdout).at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  seed(
    p,
    open("root", { title: "Root" }),
    realDecided("a", { parent: "root" }),
    realDecided("b", { parent: "root" }),
    { type: "node.proposed", id: "ghost", kind: "card", title: "Ghost", status: "decided", parent: "root" },
  );
  write("spec.md", SPEC(1));
  write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "root, a", stories: "1" }));
  const r = await check();
  const setLines = lines(r.stdout).filter((l) => l.startsWith("ticket set"));
  expect(setLines.length).toBe(1);
  expect(setLines[0]).toContain("b");
  expect(r.stdout).not.toContain("ghost");
  expect(lines(r.stdout).at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on it", async () => {
  seed(p, open("root", { title: "Root" }), realDecided("a", { parent: "root" }));
  write("spec.md", SPEC(1));
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "a", stories: "1", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "a", stories: "1", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "a", stories: "1", blockedBy: "3" }));
  const r = await check();
  expect(r.stdout).toMatch(/02-b\.md: blocked_by:/);
  expect(r.stdout).toMatch(/03-c\.md: blocked_by:/);
  expect(r.stdout).not.toMatch(/01-a\.md/);
  expect(r.stdout).not.toMatch(/04-d\.md/);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  twoCards();
  write("spec.md", "# Spec\n\nNothing here.\n");
  write("tickets/01-a.md", ticket({ cites: "a, b", stories: "1" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/no "User stories" heading/);
  expect(r.stdout).not.toMatch(/failures/);
});
