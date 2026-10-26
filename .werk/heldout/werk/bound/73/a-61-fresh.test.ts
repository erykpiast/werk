// Step 61.1: the first commit is empty, every later commit descends from it, and a fresh clone passes every check.
import { afterAll, expect, test } from "bun:test";
import { CHECKOUT, cloneCheckout, make, removeCopies, sh } from "./a-helpers.ts";

afterAll(removeCopies);

test("61.1 empty first commit and a fresh clone that passes the five checks", () => {
  const roots = sh(CHECKOUT, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
  const first = sh(CHECKOUT, ["git", "rev-list", "--reverse", "--first-parent", "main"]).out.trim().split("\n")[0];
  console.log("roots:", roots, "first:", first);
  expect(sh(CHECKOUT, ["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
  // Every commit on main has the first commit as an ancestor: it is the only root.
  expect(roots).toEqual([first]);

  const dir = cloneCheckout();
  expect(sh(dir, ["bun", "install", "--frozen-lockfile"]).code).toBe(0);
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const run = make(dir, target);
    console.log(`--- make ${target}: exit ${run.code}\n`, run.out.slice(-700));
    expect(run.code, `make ${target}`).toBe(0);
  }
});
