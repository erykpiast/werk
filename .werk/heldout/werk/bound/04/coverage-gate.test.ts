import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const p = Bun.spawnSync(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

test("01.1 test, coverage, then missing own test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-01-"));
  try {
    cpSync(repo, dir, {
      recursive: true,
      filter: (s) => !/\/(\.git|\.werk-heldout|node_modules)(\/|$)/.test(s),
    });
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    const pure: string[] = (await_import(dir));
    expect(pure.length).toBeGreaterThan(0);

    const t = make(dir, "test");
    expect(t.code).toBe(0);
    expect(t.out).not.toMatch(/coverage-gate|% Funcs|Uncovered Line/);

    const c = make(dir, "test-coverage");
    expect(c.code).toBe(0);
    for (const f of pure) {
      expect(c.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/[./]/g, "\\$&")}`));
    }

    const victim = pure[0];
    const own = victim.replace(/\.ts$/, ".test.ts");
    expect(existsSync(join(dir, own))).toBe(true);
    rmSync(join(dir, own));
    const c2 = make(dir, "test-coverage");
    expect(c2.out).toMatch(new RegExp(`\\b0(\\.0+)?%\\s+${victim.replace(/[./]/g, "\\$&")}`));
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain(own);
    const t2 = make(dir, "test");
    // test run may fail only if other tests need the deleted file; the step says no coverage failure
    expect(t2.out).not.toMatch(/0%/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 300000);

function await_import(dir: string): string[] {
  const src = require("node:fs").readFileSync(join(dir, "src/test/pure-files.ts"), "utf8");
  return [...src.matchAll(/"(src\/[^"]+\.ts)"/g)].map((m) => m[1] as string);
}
