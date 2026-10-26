import { afterEach, beforeEach, expect, test } from "bun:test";
import { harness } from "./util.ts";

const h = harness();
beforeEach(() => h.create());
afterEach(() => h.dispose());

const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  h.seedBoard(...done("app/01"));
  const rec = await h.werk(
    "followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the link expires after 1 minute, the card says 15",
    "--catchable", "yes",
  );
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const list = await h.werk("followup", "app/01", "--list");
  expect(list.stdout).toContain("1.");
  expect(list.stdout).toContain("build");
  expect(list.stdout).toContain("after-merge");
  expect(list.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(list.stdout).toContain("yes");
}, 30000);

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  h.seedBoard(...done("app/01"));
  const rec = await h.werk(
    "followup", "app/01", "--class", "plan", "--found", "review",
    "--why", "no card said how long the link lasts",
  );
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const list = await h.werk("followup", "app/01", "--list");
  expect(list.stdout).toContain("1.");
  expect(list.stdout).toContain("plan");
  expect(list.stdout).toContain("review");
  expect(list.stdout).toContain("no card said how long the link lasts");
  expect(list.stdout).not.toContain("catch");
}, 30000);

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  h.seedBoard(...done("app/01"));
  const a = await h.werk(
    "followup", "app/01", "--class", "build", "--found", "review",
    "--why", "the button label is wrong",
  );
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs .*catchable answer/);
  const b = await h.werk(
    "followup", "app/01", "--class", "plan", "--found", "review",
    "--why", "the card was silent", "--catchable", "no",
  );
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss has no catchable answer/);
  const list = await h.werk("followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
}, 30000);

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  h.seedBoard(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await h.werk(
    "followup", "app/02", "--class", "build", "--found", "review",
    "--why", "rename the button", "--catchable", "no",
  );
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await h.werk(
    "followup", "app/99", "--class", "plan", "--found", "review",
    "--why", "missing rule",
  );
  expect(b.code).not.toBe(0);
  expect(b.stderr.toLowerCase()).toMatch(/no ticket|not exist|does not/);
  const list = await h.werk("followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
}, 30000);

test("43.5 the last correction of a record is the class in force", async () => {
  h.seedBoard(...done("app/01"));
  await h.werk(
    "followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the link expires after 1 minute, the card says 15",
    "--catchable", "yes",
  );
  const c1 = await h.werk(
    "followup", "app/01", "--class", "plan", "--found", "after-merge",
    "--why", "the card never said 15 minutes", "--of", "1",
  );
  expect(c1.code).toBe(0);
  const l1 = (await h.werk("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/1\. corrected by 2, in force: plan miss/);
  expect(l1).toMatch(/2\. correction of 1/);
  const c2 = await h.werk(
    "followup", "app/01", "--class", "build", "--found", "after-merge",
    "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1",
  );
  expect(c2.code).toBe(0);
  const l2 = (await h.werk("followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/1\. corrected by 3, in force: build miss/);
}, 30000);
