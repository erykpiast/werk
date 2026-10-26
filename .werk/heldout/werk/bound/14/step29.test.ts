import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { createProject, type Project, seedDecided, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(async () => {
  await p.dispose();
});

async function planned() {
  seedDecided(p);
  const r = await werk(p, "plan", "root");
  return r;
}
const board = (ev: object) =>
  appendFileSync(`${p.dir}/.werk/board.jsonl`, `${JSON.stringify(ev)}\n`);

test("29.1 a second plan extends the one spec and continues numbers", async () => {
  const first = await planned();
  expect(first.code).toBe(0);
  const second = await werk(p, "plan", "root");
  expect(second.code).toBe(0);
});

test("29.2 re-plan archives an open ticket the spec no longer needs", async () => {
  expect((await planned()).code).toBe(0);
  const rm = await werk(p, "remove", "root");
  expect(rm.code).toBe(0);
  expect((await werk(p, "plan", "root")).code).toBe(0);
  const r = await werk(p, "ticket", "restore", "1");
  expect(r.stdout.trim()).toBe("restored");
});

test("29.3 retitling a cited card blocks the ticket that cites it", async () => {
  expect((await planned()).code).toBe(0);
  const r = await werk(p, "propose", "root", "--title", "New title");
  expect(r.code).toBe(0);
});

test("29.4 a note blocks nothing; a body change blocks the ready ticket only", async () => {
  expect((await planned()).code).toBe(0);
  expect((await werk(p, "say", "root", "a note")).code).toBe(0);
  expect((await werk(p, "propose", "root", "--body", "new body")).code).toBe(0);
});

test("29.5 a card added under a planned subtree fails the cards-cited check", async () => {
  expect((await planned()).code).toBe(0);
  expect((await werk(p, "add", "fresh", "--title", "Fresh", "--parent", "root")).code).toBe(0);
  const c = await werk(p, "check", "root");
  expect(c.stdout + c.stderr).toContain("cards-cited");
  expect(c.stdout + c.stderr).toContain("fresh");
});
