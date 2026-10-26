import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { make, SLOW } from "./helper.ts";

let t: ReturnType<typeof make>;
beforeEach(() => {
  t = make();
});
afterEach(() => t.project.dispose());

const boardPath = () => join(t.project.dir, ".werk", "board.jsonl");
const seedBoard = (...events: unknown[]) => {
  mkdirSync(join(t.project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const boardText = () => readFileSync(boardPath(), "utf8");
const list = (id: string) => t.werk("followup", id, "--list");

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(...done("app/01"));
  expect((await list("app/01")).stdout.trim()).toBe("");
  const r = await t.werk("followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = (await list("app/01")).stdout;
  console.log(l);
  expect(l).toContain("1");
  expect(l).toContain("build");
  expect(l).toContain("after-merge");
  expect(l).toContain("the link expires after 1 minute, the card says 15");
  expect(l).toMatch(/could catch: yes/);
}, SLOW);

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(...done("app/01"));
  const r = await t.werk("followup", "app/01", "--class", "plan", "--found", "review",
    "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = (await list("app/01")).stdout;
  console.log(l);
  expect(l).toContain("plan");
  expect(l).toContain("review");
  expect(l).toContain("no card said how long the link lasts");
  expect(l).not.toContain("could catch");
}, SLOW);

test("43.3 wrong catchable answers are refused and nothing is recorded", async () => {
  seedBoard(...done("app/01"));
  const a = await t.werk("followup", "app/01", "--class", "build", "--found", "review",
    "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs the catchable/i);
  const b = await t.werk("followup", "app/01", "--class", "plan", "--found", "review",
    "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss.*catchable/i);
  expect((await list("app/01")).stdout.trim()).toBe("");
}, SLOW);

test("43.4 a ticket not done, or missing, is refused", async () => {
  seedBoard(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await t.werk("followup", "app/02", "--class", "build", "--found", "review",
    "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/i);
  const b = await t.werk("followup", "app/99", "--class", "plan", "--found", "review",
    "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket/i);
  expect((await list("app/02")).stdout.trim()).toBe("");
  expect(boardText()).not.toContain("followup_recorded");
}, SLOW);

test("43.5 the last correction is the class in force", async () => {
  seedBoard(...done("app/01"), {
    type: "ticket.followup_recorded", id: "app/01", class: "build", found: "after-merge",
    why: "the link expires after 1 minute, the card says 15", catchable: true,
  });
  const c1 = await t.werk("followup", "app/01", "--class", "plan", "--found", "after-merge",
    "--why", "the card never said 15 minutes", "--of", "1");
  expect(c1.code).toBe(0);
  const l1 = (await list("app/01")).stdout;
  console.log(l1);
  expect(l1).toMatch(/1.*plan/);
  expect(l1).toMatch(/corrects (record )?1|of 1/i);
  const c2 = await t.werk("followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(c2.code).toBe(0);
  const l2 = (await list("app/01")).stdout;
  console.log(l2);
  expect(l2.split("\n")[0]).toMatch(/build/);
}, SLOW);
