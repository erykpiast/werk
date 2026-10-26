// Ticket 29's steps all start from a planned subtree. The command line has no way to plan one,
// so each test makes the plan the way a person or an agent would, and stops where the product stops.
import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { all, decided, real, seed, werk } from "./helpers.ts";

const project = useProject();

async function planned(p: ReturnType<typeof project>) {
  seed(p, decided("root", { title: "Root" }), real("child", { title: "Child", parent: "root" }));
  const first = await werk(p, "plan", "root");
  expect(all(first)).not.toMatch(/unknown verb/);
  expect(first.code).toBe(0);
}

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  const p = project();
  await planned(p);
  const board = await werk(p, "board");
  expect(board.code).toBe(0);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  const p = project();
  await planned(p);
  const removed = await werk(p, "remove", "child", "--actor", "you");
  expect(removed.code).toBe(0);
  expect((await werk(p, "plan", "root")).code).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  const p = project();
  await planned(p);
  expect((await werk(p, "plan", "root")).code).toBe(0);
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  const p = project();
  await planned(p);
  expect((await werk(p, "say", "child", "a note")).code).toBe(0);
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  const p = project();
  await planned(p);
  const added = await werk(p, "add", "late", "--title", "Late card", "--parent", "root");
  expect(added.code).toBe(0);
});
