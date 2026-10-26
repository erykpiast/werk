import { afterEach, expect, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make, removeClones, sh } from "./g-lib.ts";

afterEach(removeClones);

const lines = (s: string) => s.split("\n").filter((line) => line !== "");

test("61.1", async () => {
  const dir = await cloneCheckout();
  // The first commit of the main branch holds no files; it is the only root of main and of HEAD.
  for (const ref of ["origin/main", "HEAD"]) {
    const roots = lines((await sh(["git", "rev-list", "--max-parents=0", ref], dir)).out);
    expect(roots).toHaveLength(1);
    const files = await sh(["git", "ls-tree", "-r", "--name-only", roots[0] as string], dir);
    expect(files.code).toBe(0);
    expect(files.out).toBe("");
    // Every later commit reaches that root.
    const all = lines((await sh(["git", "rev-list", ref], dir)).out);
    expect(all.at(-1)).toBe(roots[0]);
  }
  const mainRoot = lines((await sh(["git", "rev-list", "--max-parents=0", "origin/main"], dir)).out)[0];
  const headRoot = lines((await sh(["git", "rev-list", "--max-parents=0", "HEAD"], dir)).out)[0];
  expect(headRoot).toBe(mainRoot);

  const inst = await sh(["bun", "install", "--frozen-lockfile"], dir);
  expect(inst.code, inst.all).toBe(0);
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const run = await make(dir, target);
    expect(run.code, `make ${target}\n${run.all.slice(-4000)}`).toBe(0);
  }
  // The project has browser specs now; with every spec removed, make e2e still passes.
  for (const name of readdirSync(join(dir, "e2e"))) if (name.endsWith(".e2e.ts")) rmSync(join(dir, "e2e", name));
  const empty = await make(dir, "e2e");
  expect(empty.code, empty.all.slice(-4000)).toBe(0);
}, 1_800_000);
