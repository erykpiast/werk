import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type World, world } from "./support.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.project.dispose());

const board = (...events: unknown[]) => {
  mkdirSync(join(w.project.dir, ".werk"), { recursive: true });
  writeFileSync(join(w.project.dir, ".werk", "board.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (id: string) => (await w.werk("followup", id, "--list")).stdout;

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  board(...done("app/01"));
  const r = await w.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const out = await list("app/01");
  expect(out).toMatch(/^1\./);
  expect(out).toMatch(/build/);
  expect(out).toMatch(/after.merge/);
  expect(out).toContain("the link expires after 1 minute, the card says 15");
  expect(out).toMatch(/could catch: yes|catchable:? yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  board(...done("app/01"));
  const r = await w.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const out = await list("app/01");
  expect(out).toMatch(/^1\./);
  expect(out).toMatch(/plan/);
  expect(out).toMatch(/review/);
  expect(out).toContain("no card said how long the link lasts");
  expect(out).not.toMatch(/catchable|could catch/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  board(...done("app/01"));
  const a = await w.werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).toBe(1);
  expect(a.stderr).toMatch(/build miss needs/);
  expect(a.stderr).toMatch(/catchable/);
  const b = await w.werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).toBe(1);
  expect(b.stderr).toMatch(/plan miss/);
  expect(b.stderr).toMatch(/catchable/);
  expect((await list("app/01")).trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  board(...done("app/01"), { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await w.werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).toBe(1);
  expect(a.stderr).toMatch(/not done/);
  const b = await w.werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).toBe(1);
  expect(b.stderr).toMatch(/does not exist|no ticket|not exist/);
  expect((await list("app/02")).trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  board(...done("app/01"), {
    type: "ticket.followup_recorded", id: "app/01", class: "build", found: "after-merge", why: "link lasts 1 minute", catchable: true,
  });
  const c1 = await w.werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code, c1.stderr).toBe(0);
  const l1 = (await list("app/01")).split("\n").filter(Boolean);
  expect(l1[0]).toMatch(/^1\./);
  expect(l1[0]).toMatch(/in force/);
  expect(l1[0]).toMatch(/plan/);
  expect(l1[1]).toMatch(/correction of 1/);
  const c2 = await w.werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code, c2.stderr).toBe(0);
  const l2 = (await list("app/01")).split("\n").filter(Boolean);
  expect(l2[0]).toMatch(/^1\./);
  expect(l2[0]).toMatch(/in force/);
  expect(l2[0]).toMatch(/build/);
});
