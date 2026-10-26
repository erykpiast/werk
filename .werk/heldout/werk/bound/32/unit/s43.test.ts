import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { werkHarness } from "./h.ts";

const { project, werk } = werkHarness();

const boardPath = () => join(dirname(project().logPath), "board.jsonl");
const seed = (...events: Record<string, unknown>[]) => {
  for (const e of events) appendFileSync(boardPath(), `${JSON.stringify(e)}\n`);
};
const done = (id: string) => [
  { type: "ticket.planned", id, title: `T ${id}` },
  { type: "ticket.moved", id, to: "building", actor: "loop" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seed(...done("app/01"));
  const r = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout).toMatch(/^1\./);
  expect(list.stdout).toContain("build");
  expect(list.stdout).toContain("after-merge");
  expect(list.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(list.stdout).toMatch(/catch[^\n]*yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seed(...done("app/01"));
  const r = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout).toMatch(/^1\. plan/);
  expect(list.stdout).toContain("review");
  expect(list.stdout).toContain("no card said how long the link lasts");
  expect(list.stdout).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seed(...done("app/01"));
  const a = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs (a|the) catchable answer/);
  const b = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss has no catchable answer/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seed(
    { type: "ticket.planned", id: "app/02", title: "T2" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "loop" },
  );
  const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|does not exist|not on the board/i);
  const list = await werk("followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seed(...done("app/01"));
  await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "first", "--catchable", "yes");
  const c1 = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await werk("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/1\. corrected by 2, in force: plan/);
  expect(l1).toMatch(/2\. correction of 1: plan/);
  const c2 = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await werk("followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/1\. corrected by 3, in force: build/);
});
