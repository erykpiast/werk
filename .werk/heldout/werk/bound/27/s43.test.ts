import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { boardPath, createProject, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const board = (...events: unknown[]) => {
  mkdirSync(dirname(boardPath(p)), { recursive: true });
  appendFileSync(boardPath(p), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
};
const planned = (id: string) => ({ type: "ticket.planned", id, title: `Ticket ${id}` });
const done = (id: string) => [planned(id), { type: "ticket.moved", id, to: "building" }, { type: "ticket.moved", id, to: "merging" }, { type: "ticket.merge", id }];
const list = async (id: string) => (await werk(p, "followup", id, "--list")).stdout;

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  board(...done("app/01"));
  expect((await werk(p, "followup", "app/01", "--list")).stdout.trim()).toBe("");
  const r = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/record/i);
  const l = await list("app/01");
  expect(l).toMatch(/^1\./);
  expect(l).toMatch(/build/);
  expect(l).toMatch(/after.merge/);
  expect(l).toContain("the link expires after 1 minute, the card says 15");
  expect(l).toMatch(/catch[^\n]*yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  board(...done("app/01"));
  const r = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/record/i);
  const l = await list("app/01");
  expect(l).toMatch(/^1\./);
  expect(l).toMatch(/plan/);
  expect(l).toMatch(/review/);
  expect(l).toContain("no card said how long the link lasts");
  expect(l).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  board(...done("app/01"));
  const a = await werk(p, "followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs the catchable/);
  const b = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss/);
  expect(b.stderr).toMatch(/catchable/);
  expect((await list("app/01")).trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  board(planned("app/02"), { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await werk(p, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await werk(p, "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|not exist/);
  expect((await list("app/02")).trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  board(...done("app/01"), { type: "ticket.followup_recorded", id: "app/01", class: "build", found: "after-merge", why: "the link expires", catchable: true });
  const a = await werk(p, "followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(a.code, a.stderr).toBe(0);
  const l1 = (await list("app/01")).split("\n").filter(Boolean);
  expect(l1[0]).toMatch(/^1\..*plan/);
  expect(l1[1]).toMatch(/correction of 1/);
  const b = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(b.code, b.stderr).toBe(0);
  const l2 = (await list("app/01")).split("\n").filter(Boolean);
  expect(l2[0]).toMatch(/^1\..*in force.*build/);
});
