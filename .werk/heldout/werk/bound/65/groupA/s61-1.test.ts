import { expect, test } from "bun:test";
import { cloneCheckout, sh } from "./clone.ts";

test("61.1 fresh clone, empty first commit, every check passes", () => {
  const { dir, done } = cloneCheckout();
  try {
    sh(dir, ["git", "checkout", "--quiet", "main"]);
    const roots = sh(dir, ["git", "rev-list", "--max-parents=0", "main"]).out.trim().split("\n");
    console.log("roots", roots);
    expect(roots.length).toBe(1);
    const files = sh(dir, ["git", "ls-tree", "-r", "--name-only", roots[0] as string]).out.trim();
    console.log("first commit files:", JSON.stringify(files));
    expect(files).toBe("");
    const all = sh(dir, ["git", "rev-list", "main"]).out.trim().split("\n");
    const bad = all.filter((c) => sh(dir, ["git", "merge-base", "--is-ancestor", roots[0] as string, c]).code !== 0);
    console.log("commits", all.length, "not descending from root", bad.length);
    expect(bad).toEqual([]);
    const install = sh(dir, ["bun", "install", "--frozen-lockfile"]);
    expect(install.code).toBe(0);
    const specs = sh(dir, ["sh", "-c", "ls e2e/*.e2e.ts 2>/dev/null | wc -l"]).out.trim();
    console.log("browser specs present in clone:", specs);
    const codes: Record<string, number> = {};
    for (const t of ["test", "test-coverage", "typecheck", "lint", "e2e"]) {
      const r = sh(dir, ["make", t]);
      codes[t] = r.code;
      console.log(`[make ${t}] exit ${r.code}\n${r.out.slice(-1500)}`);
    }
    expect(codes).toEqual({ test: 0, "test-coverage": 0, typecheck: 0, lint: 0, e2e: 0 });
  } finally {
    done();
  }
}, 3_000_000);
