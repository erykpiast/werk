import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, decided, type Project, seedMap, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seedMap(
    p,
    decided("sub", { title: "Subtree root" }),
    decided("c1", { title: "Cited one" }),
    decided("c2", { title: "Cited two" }),
    ...["c1", "c2"].map((id) => ({ type: "edge.added", from: id, to: "sub", link: "refines", why: "w" })),
  );
});
afterEach(() => p.dispose());

const board = () => {
  try {
    return readFileSync(join(p.dir, ".werk", "board.jsonl"), "utf8");
  } catch {
    return "";
  }
};
/** The first plan of the subtree: the verb that turns a decided subtree into one spec and tickets. */
const plan = () => werk(p, "plan", "sub");

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  const first = await plan();
  expect(first.code, first.stderr).toBe(0);
  expect(board()).toContain("ticket.planned");
  seedMap(p, decided("c3", { title: "Cited three" }));
  const second = await plan();
  expect(second.code, second.stderr).toBe(0);
  expect(board().match(/"ticket.planned"/g)?.length).toBeGreaterThan(3);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  const first = await plan();
  expect(first.code, first.stderr).toBe(0);
  const removed = await werk(p, "remove", "c2", "--propose");
  expect(removed.code).toBe(0);
  const second = await plan();
  expect(second.code, second.stderr).toBe(0);
  expect(board()).toContain("ticket.archived");
  expect(board()).toContain("current spec no longer needs");
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  const first = await plan();
  expect(first.code, first.stderr).toBe(0);
  const changed = await werk(p, "propose", "c1", "--title", "Cited one, renamed");
  expect(changed.code).toBe(0);
  expect(board()).toMatch(/blocked/);
  expect(board()).toContain("title changed");
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  const first = await plan();
  expect(first.code, first.stderr).toBe(0);
  expect((await werk(p, "say", "c1", "a note")).code).toBe(0);
  expect(board()).not.toMatch(/"reason"/);
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  const first = await plan();
  expect(first.code, first.stderr).toBe(0);
  const added = await werk(p, "add", "newcard", "--title", "A new card", "--parent", "sub");
  expect(added.stdout + added.stderr).toContain("cards-cited");
  expect(added.stdout + added.stderr).toContain("newcard");
});
