import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { decided, ghost, makeProject, real, werkIn, writeLines } from "./helpers.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = makeProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seedBoard = (...evs: unknown[]) => writeLines(boardPath(), evs);
const boardLines = () => (existsSync(boardPath()) ? readFileSync(boardPath(), "utf8").trim().split("\n") : []);
const boardBytes = () => readFileSync(boardPath(), "utf8");
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

// ---------- 27 ----------
test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seedBoard({ type: "ticket.planned", id: "auth/01" });
  const decisionBefore = existsSync(project.logPath) ? readFileSync(project.logPath, "utf8") : "";
  const mv = await werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code).toBe(0);
  const ar = await werk("ticket", "archive", "auth/01");
  expect(ar.code).toBe(0);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*archived/);
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const n = boardLines().length;
  const rs = await werk("ticket", "restore", "01", "--actor", "you");
  expect(rs.code).toBe(0);
  const after = await werk("ticket", "list");
  expect(after.stdout).toMatch(/auth\/01.*blocked|blocked[\s\S]*auth\/01/);
  expect(after.stdout).toContain("waits for the token API");
  expect(boardLines()).toHaveLength(n + 1);
  const last = JSON.parse(boardLines().at(-1) as string);
  expect(last.type).toBe("ticket.restored");
  expect(last.actor).toBe("you");
  const decisionAfter = existsSync(project.logPath) ? readFileSync(project.logPath, "utf8") : "";
  expect(decisionAfter).toBe(decisionBefore);
});

test("27.2 a move without a reason is refused", async () => {
  seedBoard({ type: "ticket.planned", id: "auth/01" });
  const before = boardBytes();
  const mv = await werk("ticket", "move", "auth/01", "blocked");
  expect(mv.code).not.toBe(0);
  expect(mv.stderr).toMatch(/reason/);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*ready|ready[\s\S]*auth\/01/);
  expect(boardBytes()).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seedBoard({ type: "ticket.planned", id: "auth/02" });
  const before = boardBytes();
  const r1 = await werk("ticket", "restore", "02");
  expect(r1.code).toBe(1);
  expect(boardBytes()).toBe(before);
  const r2 = await werk("ticket", "restore", "99");
  expect(r2.code).toBe(1);
  expect(boardBytes()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seedBoard(...done("auth/03"));
  const before = boardBytes();
  const ar = await werk("ticket", "archive", "auth/03");
  expect(ar.code).not.toBe(0);
  expect(ar.stderr).toMatch(/done/);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/03.*done|done[\s\S]*auth\/03/);
  expect(list.stdout).not.toMatch(/auth\/03.*archived/);
  expect(boardBytes()).toBe(before);
});

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  seedBoard(
    { type: "ticket.planned", id: "auth/01" },
    { type: "ticket.planned", id: "auth/02" },
    { type: "ticket.planned", id: "auth/03" },
  );
  const mv = await werk("ticket", "move", "auth/02", "blocked", "--reason", "needs token");
  expect(mv.code).toBe(0);
  const ar = await werk("ticket", "archive", "auth/03");
  expect(ar.code).toBe(0);
  const list = await werk("ticket", "list");
  expect(list.stdout).toMatch(/auth\/01.*ready/);
  expect(list.stdout).toMatch(/auth\/02.*blocked.*needs token/);
  expect(list.stdout).toMatch(/auth\/03.*archived/);
  for (const line of boardLines().slice(3)) expect(JSON.parse(line).actor).toBeTruthy();
});

// ---------- 30 ----------
const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const check = () => werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const spec2 = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const reopenRoot = { type: "node.reopened", id: "root", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" };
const mapTwo = () =>
  // The contract refuses a decided card under an open parent, so the root is decided with its
  // children and then reopened: the root is open, the two children stay decided.
  writeLines(project.logPath, [
    decided("root", { title: "Root" }),
    decided("a", { title: "A", parent: "root" }),
    decided("b", { title: "B", parent: "root" }),
    reopenRoot,
  ].flat());

test("30.1 a folder of correct tickets passes", async () => {
  mapTwo();
  write("spec.md", spec2);
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = r.stdout.trim().split("\n");
  expect(out).toHaveLength(1);
  expect(out[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  mapTwo();
  write("spec.md", spec2);
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1,2" }));
  // 12th line of the body: the file path with a slash and an extension
  const lines = [
    "title: Second",
    "cites: b",
    "blocked_by: ",
    "stories: 2",
    "touches: map view",
    "",
    "## What to build",
    "",
    "Do the thing.",
    "More words here.",
    "Still more words.",
    "Edit src/loop.ts to do it.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] It works.",
    "",
    "## Checks",
    "",
    "- `make test`",
    "",
  ];
  write("tickets/02-b.md", lines.join("\n"));
  write("tickets/03-c.md", ticket({ touches: null, cites: "a", stories: "1" }));
  const r = await check();
  const out = r.stdout.trim().split("\n");
  expect(out.some((l) => /^02-b\.md: no-file-paths: .*src\/loop\.ts \(line 12\)/.test(l))).toBe(true);
  expect(out.some((l) => /^03-c\.md: shape: touches:/.test(l))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  writeLines(project.logPath, [
    decided("root", { title: "Root" }),
    decided("a", { title: "A", parent: "root" }),
    decided("b", { title: "B", parent: "root" }),
    reopenRoot,
    ghost("gh", { title: "Ghost", parent: "root", status: "decided" }),
  ].flat());
  write("spec.md", "## User stories\n\n1. As a person, I want a.\n");
  write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  const r = await check();
  const out = r.stdout.trim().split("\n");
  const setLines = out.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("b");
  expect(r.stdout).not.toContain("gh");
  expect(out.at(-1)).toMatch(/, 2 decided cards,/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  mapTwo();
  write("spec.md", spec2);
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1", blockedBy: "" }));
  write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "a", stories: "1", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "b", stories: "2", blockedBy: "3" }));
  const r = await check();
  const out = r.stdout.trim().split("\n");
  expect(out.some((l) => l.startsWith("02-b.md: blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md: blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  mapTwo();
  write("spec.md", "# Spec\n\nNo stories here.\n");
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});

// ---------- 43 ----------
const doneApp = () => seedBoard(...done("app/01"));

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  doneApp();
  const r = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const list = await werk("followup", "app/01", "--list");
  const l = list.stdout.trim().split("\n");
  expect(l).toHaveLength(1);
  expect(l[0]).toMatch(/^1\./);
  expect(l[0]).toContain("build");
  expect(l[0]).toContain("after-merge");
  expect(l[0]).toContain("the link expires after 1 minute, the card says 15");
  expect(l[0]).toMatch(/could catch: yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  doneApp();
  const r = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout).toMatch(/^1\./);
  expect(list.stdout).toContain("plan");
  expect(list.stdout).toContain("review");
  expect(list.stdout).toContain("no card said how long the link lasts");
  expect(list.stdout).not.toMatch(/catchable/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  doneApp();
  const a = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs/);
  expect(a.stderr).toMatch(/catchable/);
  const b = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss/);
  expect(b.stderr).toMatch(/catchable/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket|not on the board/i);
  const list = await werk("followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  doneApp();
  await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "link lasts 1 minute", "--catchable", "yes");
  const c1 = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await werk("followup", "app/01", "--list")).stdout.trim().split("\n");
  expect(l1[0]).toMatch(/^1\..*in force: plan/);
  expect(l1[1]).toMatch(/^2\..*correction of 1/);
  const c2 = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await werk("followup", "app/01", "--list")).stdout.trim().split("\n");
  expect(l2[0]).toMatch(/^1\..*in force: build/);
});
