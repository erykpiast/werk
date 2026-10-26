// 61.1: A fresh clone builds on an empty first commit and passes every check.
import { afterAll, expect, test } from "bun:test";
import { copyCheckout, sh } from "./copy.ts";

const copy = copyCheckout();
afterAll(() => copy.remove());

test("61.1", () => {
  const roots = sh(copy.dir, "git rev-list --max-parents=0 main").out.trim().split("\n");
  expect(roots).toHaveLength(1);
  const first = roots[0] as string;
  expect(sh(copy.dir, `git ls-tree -r ${first}`).out.trim()).toBe("");
  const commits = sh(copy.dir, "git rev-list main").out.trim().split("\n");
  for (const c of commits) expect(sh(copy.dir, `git merge-base --is-ancestor ${first} ${c}`).code).toBe(0);

  for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
    const r = sh(copy.dir, `make ${target}`);
    console.log(`== make ${target}: ${r.code}\n${r.out.slice(-1200)}`);
    expect({ target, code: r.code }).toEqual({ target, code: 0 });
  }
}, 1_800_000);

test("61.1: make e2e passes on the scaffold commit, which has no browser spec", () => {
  const scaffold = sh(copy.dir, "git rev-list --reverse main").out.trim().split("\n")[1] as string;
  expect(sh(copy.dir, `git checkout --quiet ${scaffold}`).code).toBe(0);
  const specs = sh(copy.dir, "git ls-files '*.e2e.ts' '*.spec.ts'").out.trim();
  expect(specs).toBe("");
  const r = sh(copy.dir, "make e2e");
  console.log(r.out.slice(-800));
  expect(r.code).toBe(0);
}, 600_000);
