import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  boardText,
  createProject,
  doneTicket,
  type Project,
  planned,
  seedBoard,
  werk,
} from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const fu = (...a: string[]) => werk(p, "followup", ...a);

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(p, doneTicket("app/01"));
  const r = await fu("app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const l = (await fu("app/01", "--list")).stdout;
  expect(l).toMatch(/^1\./m);
  expect(l).toMatch(/build/);
  expect(l).toMatch(/after-merge|after merge/);
  expect(l).toContain("the link expires after 1 minute, the card says 15");
  expect(l).toMatch(/catch.*yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(p, doneTicket("app/01"));
  const r = await fu("app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const l = (await fu("app/01", "--list")).stdout;
  expect(l).toMatch(/^1\. plan/m);
  expect(l).toMatch(/review/);
  expect(l).toContain("no card said how long the link lasts");
  expect(l).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing recorded", async () => {
  seedBoard(p, doneTicket("app/01"));
  const a = await fu("app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs .*catchable/);
  const b = await fu("app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss .*catchable/);
  const l = (await fu("app/01", "--list")).stdout;
  expect(l.trim()).toBe("");
});

test("43.4 a ticket that is not done or does not exist is refused", async () => {
  seedBoard(p, planned("app/02"), { type: "ticket.moved", id: "app/02", to: "building", actor: "loop" });
  const a = await fu("app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await fu("app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|does not exist/);
  expect((await fu("app/02", "--list")).stdout.trim()).toBe("");
  expect(boardText(p)).not.toContain("followup_recorded");
});

test("43.5 the last correction is the class in force", async () => {
  seedBoard(p, doneTicket("app/01"));
  await fu("app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes");
  const c1 = await fu("app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await fu("app/01", "--list")).stdout;
  expect(l1).toMatch(/1\. corrected by 2, in force: plan/);
  expect(l1).toMatch(/2\. correction of 1/);
  const c2 = await fu("app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await fu("app/01", "--list")).stdout;
  expect(l2).toMatch(/1\. corrected by 3, in force: build/);
});
