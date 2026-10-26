import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
});
afterEach(() => p.dispose());

const board = () => join(p.dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) =>
  appendFileSync(board(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const boardLines = () => readFileSync(board(), "utf8").trim().split("\n");
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (t: string) => (await werk(p, "followup", t, "--list")).stdout;

test("43.1 a build miss is recorded and listed", async () => {
  seed(...done("app/01"));
  const r = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = await list("app/01");
  expect(l).toMatch(/^1\./m);
  expect(l).toContain("build");
  expect(l).toContain("after-merge");
  expect(l).toContain("the link expires after 1 minute, the card says 15");
  expect(l).toMatch(/catch.*yes/i);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seed(...done("app/01"));
  const r = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = await list("app/01");
  expect(l).toMatch(/^1\./m);
  expect(l).toContain("plan");
  expect(l).toContain("review");
  expect(l).toContain("no card said how long the link lasts");
  expect(l).not.toMatch(/catch/i);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seed(...done("app/01"));
  const before = boardLines().length;
  const a = await werk(p, "followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs/);
  expect(a.stderr).toMatch(/catchable/);
  const b = await werk(p, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss/);
  expect(b.stderr).toMatch(/catchable/);
  expect(b.stderr).toMatch(/does not take|has no|no catchable/);
  expect((await list("app/01")).trim()).toBe("");
  expect(boardLines().length).toBe(before);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seed({ type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await werk(p, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await werk(p, "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|does not exist|not exist/);
  expect((await list("app/02")).trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seed(...done("app/01"));
  const first = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute", "--catchable", "yes");
  expect(first.code, first.stderr).toBe(0);
  const c1 = await werk(p, "followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code, c1.stderr).toBe(0);
  const l1 = (await list("app/01")).split("\n");
  expect(l1[0]).toMatch(/^1\..*in force.*plan miss/);
  expect(l1[1]).toMatch(/^2\..*correction of 1/);
  const c2 = await werk(p, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code, c2.stderr).toBe(0);
  const l2 = (await list("app/01")).split("\n");
  expect(l2[0]).toMatch(/^1\..*in force.*build miss/);
});
