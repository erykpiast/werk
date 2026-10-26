import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project, tools } from "./h.ts";

let project: Project;
let t: ReturnType<typeof tools>;
beforeEach(() => {
  project = createProject();
  t = tools(project);
});
afterEach(() => project.dispose());

const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const fu = (...a: string[]) => t.werk("followup", "app/01", ...a);

test("43.1 build miss recorded and listed", async () => {
  t.seedBoard(...done("app/01"));
  const r = await fu("--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("recorded");
  const l = await fu("--list");
  console.log("43.1", l.stdout);
  expect(l.stdout).toContain("1");
  expect(l.stdout).toContain("build");
  expect(l.stdout).toMatch(/after.merge/);
  expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
  expect(l.stdout).toMatch(/could catch: yes/);
});

test("43.2 plan miss", async () => {
  t.seedBoard(...done("app/01"));
  const r = await fu("--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  const l = await fu("--list");
  console.log("43.2", l.stdout);
  expect(l.stdout).toContain("plan");
  expect(l.stdout).toContain("review");
  expect(l.stdout).toContain("no card said how long the link lasts");
  expect(l.stdout).not.toMatch(/catchable/);
});

test("43.3 wrong catchable refused", async () => {
  t.seedBoard(...done("app/01"));
  const a = await fu("--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs the catchable/);
  const b = await fu("--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss .*catchable answer/);
  const l = await fu("--list");
  expect(l.stdout.trim()).toBe("");
});

test("43.4 not done / missing refused", async () => {
  t.seedBoard(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const a = await t.werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toContain("not done");
  const b = await t.werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket|not on the board|unknown/i);
  const l = await t.werk("followup", "app/02", "--list");
  expect(l.stdout.trim()).toBe("");
});

test("43.5 last correction is the class in force", async () => {
  t.seedBoard(...done("app/01"));
  await fu("--class", "build", "--found", "after-merge", "--why", "late", "--catchable", "yes");
  const a = await fu("--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(a.code).toBe(0);
  const l1 = await fu("--list");
  console.log("43.5a", l1.stdout);
  expect(l1.stdout).toMatch(/plan.*in force|in force.*plan/);
  expect(l1.stdout).toMatch(/correct/);
  const b = await fu("--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(b.code).toBe(0);
  const l2 = await fu("--list");
  console.log("43.5b", l2.stdout);
  expect(l2.stdout).toMatch(/build.*in force|in force.*build/);
});
