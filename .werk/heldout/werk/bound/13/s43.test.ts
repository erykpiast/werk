// 43.1 - 43.5: the followup verb.
import { expect, test } from "bun:test";
import { useTools } from "./support.ts";

const t = useTools();
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (id: string) => (await t().werk("followup", id, "--list")).stdout;
const boardLines = () => {
  const { readFileSync, existsSync } = require("node:fs");
  const p = `${t().project.dir}/.werk/board.jsonl`;
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").length : 0;
};

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  t().seedBoard(done("app/01"));
  const { werk } = t();
  const r = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const out = await list("app/01");
  expect(out).toMatch(/^1\./m);
  expect(out).toContain("build");
  expect(out).toMatch(/after.merge/);
  expect(out).toContain("the link expires after 1 minute, the card says 15");
  expect(out).toMatch(/catch\w*:?\s*yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  t().seedBoard(done("app/01"));
  const { werk } = t();
  const r = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const out = await list("app/01");
  expect(out).toMatch(/^1\./m);
  expect(out).toContain("plan");
  expect(out).toContain("review");
  expect(out).toContain("no card said how long the link lasts");
  expect(out.toLowerCase()).not.toContain("catch");
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  t().seedBoard(done("app/01"));
  const { werk } = t();
  const a = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs (the|a) catchable answer/i);
  const b = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss.*catchable answer/i);
  expect((await list("app/01")).trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  t().seedBoard([
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  ]);
  const { werk } = t();
  const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/i);
  const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket/i);
  expect((await list("app/02")).trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  t().seedBoard(done("app/01"));
  const { werk } = t();
  const first = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute", "--catchable", "yes");
  expect(first.code, first.stderr).toBe(0);
  const fix = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(fix.code, fix.stderr).toBe(0);
  const out1 = (await list("app/01")).split("\n").filter(Boolean);
  expect(out1[0]).toMatch(/^1\..*in force: plan miss/);
  expect(out1[1]).toMatch(/^2\. correction of 1/);
  const fix2 = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(fix2.code, fix2.stderr).toBe(0);
  const out2 = (await list("app/01")).split("\n").filter(Boolean);
  expect(out2[0]).toMatch(/^1\..*in force: build miss/);
  expect(boardLines()).toBeGreaterThan(0);
});
