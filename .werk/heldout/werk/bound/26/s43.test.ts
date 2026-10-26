import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project, runner } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const w = (...a: string[]) => runner(project)(...a);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const nLines = () => readFileSync(boardPath(), "utf8").trim().split("\n").length;
const seed = (...events: unknown[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss is recorded and listed", async () => {
  seed(...done("app/01"));
  const r = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const l = await w("followup", "app/01", "--list");
  expect(l.stdout).toMatch(/^1\./m);
  expect(l.stdout).toContain("build");
  expect(l.stdout).toMatch(/after.merge/);
  expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(l.stdout).toMatch(/could catch: yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seed(...done("app/01"));
  const r = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const l = await w("followup", "app/01", "--list");
  expect(l.stdout).toMatch(/^1\./m);
  expect(l.stdout).toContain("plan");
  expect(l.stdout).toMatch(/found review/);
  expect(l.stdout).toContain("no card said how long the link lasts");
  expect(l.stdout).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seed(...done("app/01"));
  const n = nLines();
  const a = await w("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs (the|a) catchable answer/);
  const b = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss (has no|does not take) (a )?catchable answer/);
  expect(nLines()).toBe(n);
  expect((await w("followup", "app/01", "--list")).stdout.trim()).toBe("");
});

test("43.4 a ticket not done, or missing, is refused", async () => {
  seed({ type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await w("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await w("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket/);
  expect((await w("followup", "app/02", "--list")).stdout.trim()).toBe("");
});

test("43.5 the last correction is the class in force", async () => {
  seed(...done("app/01"));
  expect((await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link lasts 1 minute", "--catchable", "yes")).code).toBe(0);
  expect((await w("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1")).code).toBe(0);
  const l1 = (await w("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/^1\..*in force.*plan/m);
  expect(l1).toMatch(/^2\..*correct\w* (of )?1|correction of 1/m);
  expect((await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1")).code).toBe(0);
  const l2 = (await w("followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/^1\..*in force.*build/m);
});
