import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Board, board } from "./board.ts";

let b: Board;
beforeEach(() => {
  b = board();
});
afterEach(() => b.project.dispose());

const done = (id: string) => [
  { type: "ticket.planned", id, title: "T" },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  b.seed(...done("app/01"));
  const r = await b.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = await b.werk("followup", "app/01", "--list");
  expect(l.stdout).toMatch(/^1\. /m);
  expect(l.stdout).toContain("build");
  expect(l.stdout).toMatch(/found after[- ]merge/);
  expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(l.stdout).toMatch(/catch\w*[^\n]*: yes/);
});

test("43.2 a plan miss is recorded with no catchable answer", async () => {
  b.seed(...done("app/01"));
  const r = await b.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.stdout).toContain("recorded");
  const l = await b.werk("followup", "app/01", "--list");
  expect(l.stdout).toMatch(/^1\. .*plan/m);
  expect(l.stdout).toMatch(/found review/);
  expect(l.stdout).toContain("no card said how long the link lasts");
  expect(l.stdout).not.toMatch(/catch/i);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  b.seed(...done("app/01"));
  const n = b.lines().length;
  const a = await b.werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs a catchable|catchable/);
  const c = await b.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(c.code).not.toBe(0);
  expect(c.stderr).toMatch(/plan miss/);
  expect(c.stderr).toMatch(/catchable/);
  expect((await b.werk("followup", "app/01", "--list")).stdout.trim()).toBe("");
  expect(b.lines().length).toBe(n);
});

test("43.4 a ticket not done, or missing, is refused", async () => {
  b.seed(
    { type: "ticket.planned", id: "app/02", title: "T" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await b.werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const m = await b.werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(m.code).not.toBe(0);
  expect(m.stderr).toMatch(/does not exist|no ticket|unknown ticket/i);
  expect((await b.werk("followup", "app/02", "--list")).stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  b.seed(...done("app/01"));
  await b.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card said 15 minutes and the link lasts 1", "--catchable", "yes");
  await b.werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  const l1 = (await b.werk("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/1\. corrected by 2, in force: plan miss/);
  expect(l1).toMatch(/2\. correction of 1: plan miss/);
  await b.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  const l2 = (await b.werk("followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/1\. corrected by 3, in force: build miss/);
});
