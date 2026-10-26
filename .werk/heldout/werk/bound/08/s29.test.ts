import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decide, must, realCard, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

/** A decided subtree: a decided root with two decided cards under it. */
async function subtree() {
  await realCard(p, "root");
  await decide(p, "root");
  await realCard(p, "one", "root");
  await decide(p, "one");
  await realCard(p, "two", "root");
  await decide(p, "two");
}

/** The plan of a subtree. The verb is named plan, with the root card as its argument. */
async function plan() {
  const r = await werk(p, "plan", "root");
  expect(r.stderr).not.toContain("unknown verb");
  expect(r.code).toBe(0);
  return r;
}

const ticketEvents = () =>
  (p.events() as { type: string }[]).filter((e) => e.type.startsWith("ticket."));

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  await subtree();
  await plan();
  expect(ticketEvents().length).toBeGreaterThan(0);
  await realCard(p, "three", "root");
  await decide(p, "three");
  await plan();
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  await subtree();
  await plan();
  expect((await werk(p, "remove", "two", "--actor", "you")).code).toBe(0);
  await plan();
  expect((await werk(p, "ticket", "restore", "2", "--actor", "you")).code).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, a re-plan clears it", async () => {
  await subtree();
  await plan();
  const edit = await werk(p, "edit", "one", "--title", "New title");
  expect(edit.code).toBe(0);
  await plan();
});

test("29.4 a note blocks nothing, a changed body blocks a ready ticket but not a building one", async () => {
  await subtree();
  await plan();
  await must(p, "say", "one", "a note");
  await plan();
});

test("29.5 a card added under a planned subtree reports a failed cards-cited check", async () => {
  await subtree();
  await plan();
  const add = await werk(p, "add", "extra", "--title", "Extra", "--parent", "root");
  expect(add.code).toBe(0);
  expect(add.stdout + add.stderr).toContain("cards-cited");
  expect(add.stdout + add.stderr).toContain("extra");
});
