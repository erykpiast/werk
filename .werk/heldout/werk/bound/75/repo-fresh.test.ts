// Step 61.1: a fresh clone builds on an empty first commit and passes every check.
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { freshClone, run, sh } from "./repo-helpers.ts";

test("61.1 a fresh clone: empty root commit, every main commit descends from it, five checks pass", () => {
  const dir = freshClone("fresh");
  const roots = sh("git rev-list --max-parents=0 origin/main", dir).out.trim().split("\n");
  console.log("roots:", roots);
  expect(roots).toHaveLength(1);
  const root = roots[0] as string;
  expect(sh(`git ls-tree -r ${root}`, dir).out.trim()).toBe("");
  const all = sh("git rev-list origin/main", dir).out.trim().split("\n");
  const notDescending = all.filter((c) => sh(`git merge-base --is-ancestor ${root} ${c}`, dir).code !== 0);
  console.log(`${all.length} commits on main, ${notDescending.length} without the root as ancestor`);
  expect(notDescending).toEqual([]);

  const codes: Record<string, number> = {};
  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const r = run(["make", target], dir);
    codes[target] = r.code;
    console.log(`make ${target} -> ${r.code}\n${r.out.slice(-1500)}`);
  }
  console.log("codes:", JSON.stringify(codes));
  const specs = existsSync(join(dir, "e2e")) ? readdirSync(join(dir, "e2e")).filter((f) => f.endsWith(".e2e.ts")) : [];
  console.log("browser specs present:", specs.length);
  expect(codes).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
}, 3_600_000);
