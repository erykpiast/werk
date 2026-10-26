import { expect, test } from "bun:test";
import { cloneCheckout } from "./a-repo-copy.ts";

test("61.1 a fresh clone builds on an empty first commit and passes every check", () => {
  const c = cloneCheckout();
  try {
    const roots = c.sh(["git", "rev-list", "--max-parents=0", "HEAD"]).out.trim().split("\n");
    expect(roots).toHaveLength(1);
    const first = roots[0] as string;
    expect(c.sh(["git", "ls-tree", "-r", "--name-only", first]).out.trim()).toBe("");
    const commits = c.sh(["git", "rev-list", "HEAD"]).out.trim().split("\n");
    for (const commit of commits) expect(c.sh(["git", "merge-base", "--is-ancestor", first, commit]).code).toBe(0);
    for (const target of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = c.sh(["make", target]);
      console.log(`make ${target}:`, r.code, r.out.slice(-400));
      expect(r.code).toBe(0);
    }
  } finally {
    c.remove();
  }
}, 2_400_000);
