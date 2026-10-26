import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useWerk } from "./query-support.ts";

const { p, werk, write } = useWerk();
const board = (...events: unknown[]) =>
  write(".werk/board.jsonl", events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const log = () => readFileSync(join(p().dir, ".werk", "board.jsonl"), "utf8");
const build = ["--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes"];

test("43.1 build miss recorded and listed", async () => {
  board(...done("app/01"));
  const r = await werk("followup", "app/01", ...build);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = await werk("followup", "app/01", "--list");
  expect(l.stdout).toContain("1.");
  expect(l.stdout).toContain("build");
  expect(l.stdout).toContain("after-merge");
  expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(l.stdout).toContain("check could catch: yes");
});

test("43.2 plan miss without catchable", async () => {
  board(...done("app/01"));
  const r = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.stdout).toContain("recorded");
  const l = await werk("followup", "app/01", "--list");
  expect(l.stdout).toContain("1. plan miss, found review");
  expect(l.stdout).toContain("no card said how long the link lasts");
  expect(l.stdout).not.toContain("catch");
});

test("43.3 wrong catchable refused", async () => {
  board(...done("app/01"));
  const a = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("catchable");
  const b = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toContain("plan miss");
  const l = await werk("followup", "app/01", "--list");
  expect(l.stdout.trim()).toBe("");
});

test("43.4 not-done and missing tickets refused", async () => {
  board(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const before = log();
  const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/not exist|no ticket|unknown/i);
  const l = await werk("followup", "app/02", "--list");
  expect(l.stdout.trim()).toBe("");
  expect(log()).toBe(before);
});

test("43.5 the last correction is the class in force", async () => {
  board(...done("app/01"));
  await werk("followup", "app/01", ...build);
  await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  const l1 = await werk("followup", "app/01", "--list");
  expect(l1.stdout).toContain("1. corrected by 2, in force: plan miss");
  expect(l1.stdout).toContain("2. correction of 1: plan miss");
  const c = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c.code).toBe(0);
  const l2 = await werk("followup", "app/01", "--list");
  expect(l2.stdout).toContain("1. corrected by 3, in force: build miss");
});
