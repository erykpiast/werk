import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, dec, opn, type Project, runner, seed, write } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const check = () =>
  runner(project)("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const spec = (stories: string[] = ["a", "b"]) =>
  write(project, "spec.md", `## User stories\n\n${stories.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`);
// A decided card needs a decided parent, so the root is reopened after its children are decided.
const REOPEN = { type: "node.reopened", id: "root", at: "2026-10-10T09:00:00.000Z", reason: "invalidated" };
const lastLine = (s: string) => s.trim().split("\n").at(-1) as string;

test("30.1 a folder of correct tickets passes", async () => {
  seed(project, dec("root", undefined, { title: "Root" }), dec("card-a", "root"), dec("card-b", "root"), REOPEN);
  spec();
  write(project, "tickets/01-first.md", ticket({ cites: "card-a", stories: "1", blockedBy: "" }));
  write(project, "tickets/02-second.md", ticket({ cites: "card-b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = r.stdout.trim().split("\n");
  expect(out).toHaveLength(1);
  expect(lastLine(r.stdout)).toMatch(/2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories/);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seed(project, dec("root", undefined, { title: "Root" }), dec("card-a", "root"), dec("card-b", "root"), dec("card-c", "root"), REOPEN);
  spec(["a", "b", "c"]);
  write(project, "tickets/01-ok.md", ticket({ cites: "card-a", stories: "1" }));
  write(project, "tickets/02-path.md", ticket({ cites: "card-b", stories: "2", what: "one\ntwo\nthree\nSee src/loop.ts here" }));
  write(project, "tickets/03-notouch.md", ticket({ cites: "card-c", stories: "3", touches: null }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-path.md") && /no-file-paths/.test(l) && l.includes("src/loop.ts") && /12/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-notouch.md") && /shape/.test(l) && /touches/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  expect(lastLine(r.stdout)).toMatch(/3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
  seed(project, dec("root", undefined, { title: "Root" }), dec("card-b", "root"), dec("card-c", "root"),
    { type: "node.proposed", id: "card-ghost", kind: "card", title: "Ghost", status: "decided", parent: "root" }, REOPEN);
  spec(["a", "b"]);
  write(project, "tickets/01-first.md", ticket({ cites: "root", stories: "1" }));
  write(project, "tickets/02-second.md", ticket({ cites: "card-b", stories: "2" }));
  const r = await check();
  const setLines = r.stdout.trim().split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("card-c");
  expect(r.stdout).not.toContain("card-ghost");
  expect(lastLine(r.stdout)).toMatch(/2 decided cards/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seed(project, dec("root", undefined, { title: "Root" }), dec("c1", "root"), dec("c2", "root"), dec("c3", "root"), dec("c4", "root"), REOPEN);
  spec(["a", "b", "c", "d"]);
  write(project, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
  write(project, "tickets/02-b.md", ticket({ cites: "c2", stories: "2", blockedBy: "3" }));
  write(project, "tickets/03-c.md", ticket({ cites: "c3", stories: "3", blockedBy: "2" }));
  write(project, "tickets/04-d.md", ticket({ cites: "c4", stories: "4", blockedBy: "3" }));
  const r = await check();
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && /blocked_by/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && /blocked_by/.test(l))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md") || l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(project, dec("root", undefined, { title: "Root" }), dec("c1", "root"), REOPEN);
  write(project, "spec.md", "# Spec\n\nNothing here.\n");
  write(project, "tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/User stories/);
  expect(r.stdout.trim()).toBe("");
});
