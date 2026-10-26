import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import {
  card,
  createProject,
  decided,
  type Project,
  proposed,
  refines,
  seed,
  werkOf,
} from "./support.ts";

let project: Project;
let werk: ReturnType<typeof werkOf>;
beforeEach(() => {
  project = createProject();
  werk = werkOf(project);
});
afterEach(() => project.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const check = () =>
  werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lastLine = (s: string) => s.trim().split("\n").at(-1) as string;

// ---------------------------------------------------------------- 30
test("30.1 a folder of correct tickets passes", async () => {
  seed(
    project,
    card("root", { title: "Root" }),
    decided("da", { title: "Decided A" }),
    decided("db", { title: "Decided B" }),
    refines("da", "root"),
    refines("db", "root"),
  );
  write("spec.md", "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n");
  write("tickets/01-a.md", ticket({ cites: "da", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "db", stories: "2", blockedBy: "1" }));
  const r = await check();
  expect(r.code).toBe(0);
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lastLine(r.stdout)).toBe(
    "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
  );
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seed(
    project,
    card("root", { title: "Root" }),
    decided("da", { title: "Decided A" }),
    refines("da", "root"),
  );
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ cites: "da", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({
      cites: "da",
      stories: "1",
      what: "First line.\nSecond line.\nThird line.\nEdit src/loop.ts here.",
    }),
  );
  write("tickets/03-c.md", ticket({ cites: "da", stories: "1", touches: null }));
  const text = readFileSync(join(project.dir, "tickets/02-b.md"), "utf8");
  expect(text.split("\n")[11]).toContain("src/loop.ts"); // binder guard: line 12
  const r = await check();
  expect(r.code).toBe(1);
  const lines = r.stdout.trim().split("\n");
  const second = lines.find((l) => l.startsWith("02-b.md"));
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  expect(second).toContain("line 12");
  const third = lines.find((l) => l.startsWith("03-c.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lastLine(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  seed(
    project,
    card("root", { title: "Root" }),
    decided("da", { title: "Decided A" }),
    decided("dc", { title: "Uncited real card" }),
    refines("da", "root"),
    refines("dc", "root"),
    proposed("gh", { title: "Ghost card", status: "decided", parent: "root" }),
  );
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ cites: "root, da", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "root, da", stories: "1" }));
  const r = await check();
  expect(r.code).toBe(1);
  const setLines = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("dc");
  expect(r.stdout).not.toContain("gh");
  expect(lastLine(r.stdout)).toMatch(/\b2 decided cards\b/);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seed(
    project,
    card("root", { title: "Root" }),
    decided("da", { title: "Decided A" }),
    refines("da", "root"),
  );
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ cites: "da", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "da", stories: "1", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "da", stories: "1", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "da", stories: "1", blockedBy: "3" }));
  const r = await check();
  expect(r.code).toBe(1);
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(
    project,
    card("root", { title: "Root" }),
    decided("da", { title: "Decided A" }),
    refines("da", "root"),
  );
  write("spec.md", "# Spec\n\nNothing about stories here.\n");
  write("tickets/01-a.md", ticket({ cites: "da", stories: "1" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
});

// ---------------------------------------------------------------- 43
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seedBoard = (...events: unknown[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const doneTicket = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const boardLines = () => readFileSync(boardPath(), "utf8").trim().split("\n");

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(...doneTicket("app/01"));
  const rec = await werk(
    "followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes",
  );
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const list = await werk("followup", "app/01", "--list");
  expect(list.code).toBe(0);
  const lines = list.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^1\./);
  expect(lines[0]).toContain("build");
  expect(lines[0]).toMatch(/after[- ]merge/);
  expect(lines[0]).toContain("the link expires after 1 minute, the card says 15");
  expect(lines[0]).toMatch(/(catchable|could catch):? yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(...doneTicket("app/01"));
  const rec = await werk(
    "followup", "app/01", "--class", "plan", "--found", "review",
    "--why", "no card said how long the link lasts",
  );
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const list = await werk("followup", "app/01", "--list");
  const line = list.stdout.trim();
  expect(line).toMatch(/^1\./);
  expect(line).toContain("plan");
  expect(line).toContain("review");
  expect(line).toContain("no card said how long the link lasts");
  expect(line).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(...doneTicket("app/01"));
  const a = await werk(
    "followup", "app/01", "--class", "build", "--found", "review",
    "--why", "the button label is wrong",
  );
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs (a|the) catchable answer/);
  const b = await werk(
    "followup", "app/01", "--class", "plan", "--found", "review",
    "--why", "the card was silent", "--catchable", "no",
  );
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss (does not take|has no) (a )?catchable answer/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
  expect(boardLines()).toHaveLength(4);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await werk(
    "followup", "app/02", "--class", "build", "--found", "review",
    "--why", "rename the button", "--catchable", "no",
  );
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await werk(
    "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule",
  );
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket/);
  const list = await werk("followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(...doneTicket("app/01"));
  const first = await werk(
    "followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the link expires early", "--catchable", "yes",
  );
  expect(first.code).toBe(0);
  const c1 = await werk(
    "followup", "app/01", "--class", "plan", "--found", "after-merge",
    "--why", "the card never said 15 minutes", "--of", "1",
  );
  expect(c1.code).toBe(0);
  let lines = (await werk("followup", "app/01", "--list")).stdout.trim().split("\n");
  expect(lines[0]).toMatch(/^1\..*in force: plan/);
  expect(lines[1]).toMatch(/^2\..*correction of 1/);
  const c2 = await werk(
    "followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1",
  );
  expect(c2.code).toBe(0);
  lines = (await werk("followup", "app/01", "--list")).stdout.trim().split("\n");
  expect(lines[0]).toMatch(/^1\..*in force: build/);
});
