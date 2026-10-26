import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, seedBoard, werkIn, type Project } from "./support.ts";

let p: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  p = createProject();
  werk = werkIn(p);
});
afterEach(() => p.dispose());

const planned = (id: string) => ({ type: "ticket.planned", id, title: `T ${id}` });
const doneTicket = (id: string) => [
  planned(id),
  { type: "ticket.moved", id, to: "building", actor: "agent" },
  { type: "ticket.moved", id, to: "merging", actor: "agent" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(p, doneTicket("app/01"));
  const rec = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(rec.code).toBe(0);
  expect(rec.stdout).toMatch(/record/i);
  const list = await werk("followup", "app/01", "--list");
  expect(list.code).toBe(0);
  expect(list.stdout).toMatch(/^1\./m);
  expect(list.stdout).toMatch(/build/);
  expect(list.stdout).toMatch(/after.merge/);
  expect(list.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(list.stdout).toMatch(/catchable[^\n]*yes|catch[^\n]*yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(p, doneTicket("app/01"));
  const rec = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(rec.code).toBe(0);
  expect(rec.stdout).toMatch(/record/i);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout).toMatch(/^1\./m);
  expect(list.stdout).toMatch(/plan/);
  expect(list.stdout).toMatch(/review/);
  expect(list.stdout).toContain("no card said how long the link lasts");
  expect(list.stdout).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(p, doneTicket("app/01"));
  const a = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs (a|the) catchable answer/);
  const b = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss (does not take|has no|takes no) (a )?catchable answer/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(p, [planned("app/02"), { type: "ticket.moved", id: "app/02", to: "building", actor: "agent" }]);
  const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|does not exist/);
  const list = await werk("followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(p, doneTicket("app/01"));
  expect((await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes")).code).toBe(0);
  const c1 = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await werk("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/^1\. corrected by 2, in force: plan miss/m);
  expect(l1).toMatch(/^2\. correction of 1:/m);
  const c2 = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await werk("followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/^1\. corrected by 3, in force: build miss/m);
});
