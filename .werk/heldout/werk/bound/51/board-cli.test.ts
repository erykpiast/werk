import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { logText, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const boardPath = () => join(p.dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) => {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const board = () => {
  try {
    return readFileSync(boardPath(), "utf8");
  } catch {
    return "";
  }
};
const boardEvents = () =>
  board()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const done = (id: string) => [
  { type: "ticket.planned", id, title: `T ${id}`, actor: "agent" },
  { type: "ticket.moved", id, to: "building", actor: "agent" },
  { type: "ticket.moved", id, to: "merging", actor: "agent" },
  { type: "ticket.merge", id },
];

test("27.1 archive a blocked ticket and restore it", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "One", actor: "agent" });
  const mv = await werk(p, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.stderr).toBe("");
  expect(mv.code).toBe(0);
  const ar = await werk(p, "ticket", "archive", "auth/01");
  expect(ar.code).toBe(0);
  const list = (await werk(p, "ticket", "list")).stdout;
  expect(list).toMatch(/auth\/01.*archived/);
  expect(list).toContain("blocked");
  expect(list).toContain("waits for the token API");
  const decisionLogBefore = logText(p);
  const n = boardEvents().length;
  const rs = await werk(p, "ticket", "restore", "01", "--actor", "you");
  expect(rs.code).toBe(0);
  const after = (await werk(p, "ticket", "list")).stdout;
  expect(after).toMatch(/auth\/01/);
  expect(after).toContain("blocked");
  expect(after).toContain("waits for the token API");
  expect(after).not.toMatch(/auth\/01.*archived/);
  expect(boardEvents().length).toBe(n + 1);
  expect(boardEvents().at(-1).actor).toBe("you");
  expect(logText(p)).toBe(decisionLogBefore);
});

test("27.2 a move without a reason is refused", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "One", actor: "agent" });
  const before = board();
  const r = await werk(p, "ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("reason");
  expect(r.stderr).not.toContain("unknown flag");
  expect(r.stderr).not.toContain("needs the subverb restore");
  const list = (await werk(p, "ticket", "list")).stdout;
  expect(list).toMatch(/auth\/01.*ready|ready.*auth\/01/s);
  expect(board()).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seed(
    { type: "ticket.planned", id: "auth/02", title: "Two", actor: "agent" },
  );
  const before = board();
  const a = await werk(p, "ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(board()).toBe(before);
  const b = await werk(p, "ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(board()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seed(...done("auth/03"));
  const before = board();
  const r = await werk(p, "ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("done");
  expect(r.stderr).not.toContain("needs the subverb restore");
  const list = (await werk(p, "ticket", "list")).stdout;
  expect(list).toMatch(/auth\/03.*done/);
  expect(list).not.toMatch(/auth\/03.*archived/);
  expect(board()).toBe(before);
});

test("27.5 the listing shows every ticket in its column", async () => {
  seed(
    { type: "ticket.planned", id: "auth/01", title: "One", actor: "agent" },
    { type: "ticket.planned", id: "auth/02", title: "Two", actor: "agent" },
    { type: "ticket.planned", id: "auth/03", title: "Three", actor: "agent" },
  );
  expect((await werk(p, "ticket", "move", "auth/02", "blocked", "--reason", "needs a key")).code).toBe(0);
  expect((await werk(p, "ticket", "archive", "auth/03")).code).toBe(0);
  const out = (await werk(p, "ticket", "list")).stdout;
  expect(out).toMatch(/auth\/01.*ready/);
  expect(out).toMatch(/auth\/02.*blocked.*needs a key/);
  expect(out).toMatch(/auth\/03.*archived/);
  for (const e of boardEvents()) expect(typeof e.actor).toBe("string");
});

const followupWerk = (...a: string[]) => werk(p, "followup", ...a);

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seed(...done("app/01"));
  const r = await followupWerk("app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = (await followupWerk("app/01", "--list")).stdout;
  expect(l).toMatch(/^1\./);
  expect(l).toContain("build");
  expect(l).toMatch(/after[- ]merge/);
  expect(l).toContain("the link expires after 1 minute, the card says 15");
  expect(l).toMatch(/catch.*yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seed(...done("app/01"));
  const r = await followupWerk("app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = (await followupWerk("app/01", "--list")).stdout;
  expect(l).toMatch(/^1\./);
  expect(l).toContain("plan");
  expect(l).toContain("review");
  expect(l).toContain("no card said how long the link lasts");
  expect(l).not.toMatch(/catch/);
});

test("43.3 wrong catchable answers are refused", async () => {
  seed(...done("app/01"));
  const a = await followupWerk("app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("build miss needs");
  const b = await followupWerk("app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss has no catchable/);
  expect((await followupWerk("app/01", "--list")).stdout.trim()).toBe("");
});

test("43.4 a ticket not done or missing is refused", async () => {
  seed(
    { type: "ticket.planned", id: "app/02", title: "Two", actor: "agent" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "agent" },
  );
  const a = await followupWerk("app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await followupWerk("app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket app\/99|does not exist/);
  expect((await followupWerk("app/02", "--list")).stdout.trim()).toBe("");
});

test("43.5 the last correction is the class in force", async () => {
  seed(...done("app/01"));
  await followupWerk("app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes");
  const c1 = await followupWerk("app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await followupWerk("app/01", "--list")).stdout.split("\n");
  expect(l1[0]).toMatch(/^1\..*in force: plan/);
  expect(l1[1]).toMatch(/^2\. correction of 1/);
  const c2 = await followupWerk("app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await followupWerk("app/01", "--list")).stdout.split("\n");
  expect(l2[0]).toMatch(/^1\..*in force: build miss/);
});
