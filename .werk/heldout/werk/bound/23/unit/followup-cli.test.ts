import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useProject } from "./support.ts";

const ctx = useProject();
const boardPath = () => join(ctx.project.dir, ".werk", "board.jsonl");
const seedBoard = (...events: unknown[]) => {
  mkdirSync(join(ctx.project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const boardLines = () => readFileSync(boardPath(), "utf8").split("\n").filter(Boolean).length;
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(...done("app/01"));
  const rec = await ctx.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const list = await ctx.werk("followup", "app/01", "--list");
  const text = list.stdout;
  expect(text).toMatch(/^1\./m);
  expect(text).toContain("build");
  expect(text).toContain("after-merge");
  expect(text).toContain("the link expires after 1 minute, the card says 15");
  expect(text).toMatch(/catch\w*: yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(...done("app/01"));
  const rec = await ctx.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const text = (await ctx.werk("followup", "app/01", "--list")).stdout;
  expect(text).toMatch(/^1\./m);
  expect(text).toContain("plan");
  expect(text).toContain("review");
  expect(text).toContain("no card said how long the link lasts");
  expect(text).not.toMatch(/catch/i);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(...done("app/01"));
  const before = boardLines();
  const a = await ctx.werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs/);
  expect(a.stderr).toContain("catchable");
  const b = await ctx.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss/);
  expect(b.stderr).toMatch(/no catchable answer|does not take/);
  expect((await ctx.werk("followup", "app/01", "--list")).stdout.trim()).toBe("");
  expect(boardLines()).toBe(before);
});

test("43.4 a ticket that is not done or does not exist is refused", async () => {
  seedBoard(...done("app/01"), { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await ctx.werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await ctx.werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/no ticket app\/99|does not exist/);
  expect((await ctx.werk("followup", "app/02", "--list")).stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(...done("app/01"));
  await ctx.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute", "--catchable", "yes");
  const fix = await ctx.werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(fix.code).toBe(0);
  const first = (await ctx.werk("followup", "app/01", "--list")).stdout.trim().split("\n");
  expect(first[0]).toMatch(/^1\. corrected by 2, in force: plan miss/);
  expect(first[1]).toMatch(/^2\. correction of 1:/);
  const fix2 = await ctx.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(fix2.code).toBe(0);
  const second = (await ctx.werk("followup", "app/01", "--list")).stdout.trim().split("\n");
  expect(second[0]).toMatch(/^1\. corrected by 3, in force: build miss/);
});
