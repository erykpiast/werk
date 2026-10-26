import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { card, seed, werk } from "./util.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seed(p, [
    ...card("root", "Root", "decided", { why: "r" }),
    ...card("a", "Card A", "decided", { why: "a", parent: "root" }),
    ...card("b", "Card B", "decided", { why: "b", parent: "root" }),
  ]);
});
afterEach(() => p.dispose());

const plan = () => werk(p, "plan", "root");
const board = () => werk(p, "board");

test("29.1 a second plan extends the spec and continues ticket numbers", async () => {
  const first = await plan();
  expect(first.code).toBe(0);
  seed(p, card("n", "New card", "decided", { why: "n", parent: "root" }));
  const second = await plan();
  expect(second.code).toBe(0);
  const out = (await board()).stdout;
  expect(out).toContain("New card");
  expect(out).toMatch(/\b04\b|#4|\b4\b/);
});

test("29.2 an open ticket the new spec no longer needs is archived and restorable", async () => {
  expect((await plan()).code).toBe(0);
  expect((await werk(p, "remove", "b")).code).toBe(0);
  expect((await plan()).code).toBe(0);
  const out = (await board()).stdout;
  expect(out).toContain("no longer needs");
  const r = await werk(p, "ticket", "restore", "2");
  expect(r.code).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket; a re-plan clears it", async () => {
  expect((await plan()).code).toBe(0);
  const re = await werk(p, "retitle", "a", "--title", "Renamed");
  expect(re.code).toBe(0);
  expect((await board()).stdout).toMatch(/blocked[\s\S]*title changed/);
  expect((await plan()).code).toBe(0);
  const out = (await board()).stdout;
  expect(out).not.toContain("title changed");
  expect(out).toContain("Renamed");
});

test("29.4 a note blocks nothing; a body change blocks the ready ticket only", async () => {
  expect((await plan()).code).toBe(0);
  expect((await werk(p, "say", "a", "a note")).code).toBe(0);
  expect((await board()).stdout).not.toMatch(/blocked/i);
  expect((await werk(p, "edit", "a", "--body", "changed")).code).toBe(0);
  expect((await board()).stdout).toMatch(/body changed/);
});

test("29.5 a card added under a planned subtree fails the cards-cited check", async () => {
  expect((await plan()).code).toBe(0);
  expect((await werk(p, "add", "z", "--title", "Uncited", "--parent", "root")).code).toBe(0);
  const check = await werk(p, "check", "root");
  expect(check.stdout + check.stderr).toMatch(/cards-cited/);
  expect(check.stdout + check.stderr).toContain("z");
  expect((await board()).stdout).not.toMatch(/blocked/i);
});
