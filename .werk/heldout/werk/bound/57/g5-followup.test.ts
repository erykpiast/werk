import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { boardEvents, seedBoard, werk } from "./g5-helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (t: string) => (await werk(p, "followup", t, "--list")).stdout;

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(p, ...done("app/01"));
  const r = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const out = await list("app/01");
  expect(out).toContain("1.");
  expect(out).toContain("build");
  expect(out).toContain("after-merge");
  expect(out).toContain("the link expires after 1 minute, the card says 15");
  expect(out).toContain("yes");
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(p, ...done("app/01"));
  const r = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const out = await list("app/01");
  expect(out).toContain("1. plan");
  expect(out).toContain("review");
  expect(out).toContain("no card said how long the link lasts");
  expect(out).not.toContain("catch");
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(p, ...done("app/01"));
  const a = await werk(p, "followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs the catchable answer/);
  const b = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss has no catchable answer/);
  expect((await list("app/01")).trim()).toBe("");
  expect(boardEvents(p)).toHaveLength(4);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(p, { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await werk(p, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await werk(p, "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toContain("no ticket app/99");
  expect((await list("app/02")).trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(p, ...done("app/01"));
  await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "x", "--catchable", "yes");
  const c1 = await werk(p, "followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  let lines = (await list("app/01")).trim().split("\n");
  expect(lines[0]).toMatch(/^1\. .*in force: plan miss/);
  expect(lines[1]).toMatch(/^2\. correction of 1/);
  const c2 = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  lines = (await list("app/01")).trim().split("\n");
  expect(lines[0]).toMatch(/^1\. .*in force: build miss/);
});
