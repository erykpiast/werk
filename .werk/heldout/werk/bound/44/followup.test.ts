import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";
import { werk, type Ev } from "./lib.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const seedBoard = (...events: Ev[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(join(project.dir, ".werk", "board.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const doneTicket = (id: string): Ev[] => [
  { type: "ticket.planned", id, title: `T ${id}` },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (id: string) => (await werk(project, "followup", id, "--list")).stdout.trim().split("\n").filter(Boolean);

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(...doneTicket("app/01"));
  const r = await werk(project, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const lines = await list("app/01");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^1\./);
  expect(lines[0]).toContain("build");
  expect(lines[0]).toMatch(/after[- ]merge/);
  expect(lines[0]).toContain("the link expires after 1 minute, the card says 15");
  expect(lines[0]).toMatch(/catch[^:]*: yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(...doneTicket("app/01"));
  const r = await werk(project, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const lines = await list("app/01");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("plan");
  expect(lines[0]).toContain("review");
  expect(lines[0]).toContain("no card said how long the link lasts");
  expect(lines[0]).not.toMatch(/catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(...doneTicket("app/01"));
  const a = await werk(project, "followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs .*catchable answer/);
  const b = await werk(project, "followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss has no catchable answer/);
  expect(await list("app/01")).toEqual([]);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(
    { type: "ticket.planned", id: "app/02", title: "T 02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await werk(project, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await werk(project, "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket|does not exist/);
  expect(await list("app/02")).toEqual([]);
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(...doneTicket("app/01"));
  expect((await werk(project, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute", "--catchable", "yes")).code).toBe(0);
  const c1 = await werk(project, "followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code, c1.stderr).toBe(0);
  let lines = await list("app/01");
  expect(lines[0]).toMatch(/in force: plan miss/);
  expect(lines.some((l) => /^2\. correction of 1/.test(l))).toBe(true);
  const c2 = await werk(project, "followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code, c2.stderr).toBe(0);
  lines = await list("app/01");
  expect(lines[0]).toMatch(/in force: build miss/);
});
