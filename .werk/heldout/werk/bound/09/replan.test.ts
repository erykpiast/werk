import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { createProject, decide, must, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

/** A decided subtree: a root with two decided children. */
async function subtree() {
  await decide(p, "root", { title: "Root" });
  await decide(p, "feat-a", { title: "Feature A", parent: "root" });
  await decide(p, "feat-b", { title: "Feature B", parent: "root" });
}

/** The first plan of the subtree. The command line has no verb for it. */
async function plan() {
  const r = await werk(p, "plan", "root");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return r;
}

/** The tickets of the board, read from the board log as ticket ids. */
function boardFiles() {
  try {
    return readdirSync(`${p.dir}/.werk`);
  } catch {
    return [];
  }
}

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  await subtree();
  await plan();
  expect(boardFiles().length).toBeGreaterThan(0);
  await decide(p, "feat-c", { title: "Feature C", parent: "root" });
  await plan();
  const board = await werk(p, "board");
  expect(board.code).toBe(0);
  expect(board.stdout).toMatch(/\b4\b/);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  await subtree();
  await plan();
  await must(p, "remove", "feat-b");
  await plan();
  const restored = await werk(p, "ticket", "restore", "2", "--actor", "you");
  expect(restored.stderr).toBe("");
  expect(restored.code).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  await subtree();
  await plan();
  const r = await werk(p, "propose", "feat-a", "--title", "Feature A renamed");
  expect(r.code).toBe(0);
  await must(p, "accept", "feat-a", "--actor", "you");
  const board = await werk(p, "board");
  expect(board.stdout).toMatch(/blocked/);
  expect(board.stdout).toMatch(/feat-a/);
  expect(board.stdout).toMatch(/title/);
  await plan();
  expect((await werk(p, "board")).stdout).not.toMatch(/blocked/);
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  await subtree();
  await plan();
  await must(p, "say", "feat-a", "a note");
  expect((await werk(p, "board")).stdout).not.toMatch(/blocked/);
  const r = await werk(p, "propose", "feat-a", "--ops", '[{"tag":"new","new":"more words"}]');
  expect(r.code).toBe(0);
  await must(p, "accept", "feat-a", "--actor", "you");
  const board = await werk(p, "board");
  expect(board.stdout).toMatch(/blocked/);
  expect(board.stdout).toMatch(/building/);
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  await subtree();
  await plan();
  await decide(p, "feat-new", { title: "Feature New", parent: "root" });
  const board = await werk(p, "board");
  expect(board.stdout).not.toMatch(/blocked/);
  const check = await werk(p, "plan", "root", "--check");
  expect(check.stdout + check.stderr).toContain("cards-cited");
  expect(check.stdout + check.stderr).toContain("feat-new");
});
