import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project, seedBoard, werk } from "./support.ts";

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
const building = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(p, done("app/01"));
  const r = await werk(
    p,
    "followup",
    "app/01",
    "--class",
    "build",
    "--found",
    "after-merge",
    "--why",
    "the link expires after 1 minute, the card says 15",
    "--catchable",
    "yes",
  );
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const list = await werk(p, "followup", "app/01", "--list");
  expect(list.code).toBe(0);
  const out = list.stdout;
  expect(out).toMatch(/^1\./m);
  expect(out).toContain("build");
  expect(out).toMatch(/after[- ]merge/);
  expect(out).toContain("the link expires after 1 minute, the card says 15");
  expect(out).toMatch(/catch[^\n]*\byes\b/i);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(p, done("app/01"));
  const r = await werk(
    p,
    "followup",
    "app/01",
    "--class",
    "plan",
    "--found",
    "review",
    "--why",
    "no card said how long the link lasts",
  );
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const out = (await werk(p, "followup", "app/01", "--list")).stdout;
  expect(out).toMatch(/^1\./m);
  expect(out).toContain("plan");
  expect(out).toContain("review");
  expect(out).toContain("no card said how long the link lasts");
  expect(out).not.toMatch(/catch/i);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(p, done("app/01"));
  const a = await werk(
    p,
    "followup",
    "app/01",
    "--class",
    "build",
    "--found",
    "review",
    "--why",
    "the button label is wrong",
  );
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs a? ?(the )?catchable/);
  const b = await werk(
    p,
    "followup",
    "app/01",
    "--class",
    "plan",
    "--found",
    "review",
    "--why",
    "the card was silent",
    "--catchable",
    "no",
  );
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss/);
  expect(b.stderr).toMatch(/catchable/);
  const list = await werk(p, "followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(p, building("app/02"));
  const a = await werk(
    p,
    "followup",
    "app/02",
    "--class",
    "build",
    "--found",
    "review",
    "--why",
    "rename the button",
    "--catchable",
    "no",
  );
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await werk(
    p,
    "followup",
    "app/99",
    "--class",
    "plan",
    "--found",
    "review",
    "--why",
    "missing rule",
  );
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket/);
  const list = await werk(p, "followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(p, [
    ...done("app/01"),
    {
      type: "ticket.followup_recorded",
      id: "app/01",
      class: "build",
      found: "after-merge",
      why: "the link expires after 1 minute",
      catchable: true,
    },
  ]);
  const c1 = await werk(
    p,
    "followup",
    "app/01",
    "--class",
    "plan",
    "--found",
    "after-merge",
    "--why",
    "the card never said 15 minutes",
    "--of",
    "1",
  );
  expect(c1.code).toBe(0);
  const l1 = (await werk(p, "followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/^1\.[^\n]*in force[^\n]*plan/m);
  expect(l1).toMatch(/^2\.[^\n]*correct[^\n]*\b1\b/m);
  const c2 = await werk(
    p,
    "followup",
    "app/01",
    "--class",
    "build",
    "--found",
    "after-merge",
    "--why",
    "the card does say 15 minutes",
    "--catchable",
    "yes",
    "--of",
    "1",
  );
  expect(c2.code).toBe(0);
  const l2 = (await werk(p, "followup", "app/01", "--list")).stdout;
  expect(l2).toMatch(/^1\.[^\n]*in force[^\n]*build/m);
});
