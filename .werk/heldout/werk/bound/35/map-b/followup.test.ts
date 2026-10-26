import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { seedBoard, werk } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const run = (...a: string[]) => werk(project, ...a);

const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = (id: string) => run("followup", id, "--list");

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(project, ...done("app/01"));
  const r = await run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const l = await list("app/01");
  expect(l.code).toBe(0);
  expect(l.stdout).toMatch(/^1\./);
  expect(l.stdout).toContain("build");
  expect(l.stdout).toContain("after-merge");
  expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(l.stdout).toMatch(/catch\w*: yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(project, ...done("app/01"));
  const r = await run("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const l = await list("app/01");
  expect(l.stdout).toMatch(/^1\./);
  expect(l.stdout).toContain("plan");
  expect(l.stdout).toContain("review");
  expect(l.stdout).toContain("no card said how long the link lasts");
  expect(l.stdout.toLowerCase()).not.toContain("catch");
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(project, ...done("app/01"));
  const a = await run("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr.toLowerCase()).toContain("catchable");
  const b = await run("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr.toLowerCase()).toContain("plan miss");
  expect((await list("app/01")).stdout.trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(project, { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await run("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await run("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr.toLowerCase()).toMatch(/not exist|no ticket|unknown/);
  expect((await list("app/02")).stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(project, ...done("app/01"));
  await run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes");
  const c1 = await run("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await list("app/01")).stdout;
  expect(l1).toMatch(/1\. corrected by 2, in force: plan/);
  expect(l1).toMatch(/2\. correction of 1/);
  const c2 = await run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await list("app/01")).stdout;
  expect(l2).toMatch(/1\. corrected by 3, in force: build/);
});
