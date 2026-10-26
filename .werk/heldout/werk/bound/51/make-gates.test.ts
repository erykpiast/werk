import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ownTestPath } from "../src/test/coverage-report.ts";

const ROOT = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd, env: { ...process.env, CI: "true" } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("01.1 make test, make test-coverage, and a deleted own test", () => {
  // The checkout stays untouched: the steps run on a copy.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "heldout-01-")));
  try {
    const copy = join(dir, "w");
    const cp = Bun.spawnSync(["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", `${ROOT}/`, `${copy}/`]);
    expect(cp.exitCode).toBe(0);

    const t = make(copy, "test");
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/\d+ pass/);
    expect(t.out.toLowerCase()).not.toContain("coverage");

    const c = make(copy, "test-coverage");
    expect(c.code, c.out.slice(-3000)).toBe(0);
    const unique = [...new Set(PURE_FILES)];
    for (const f of unique) {
      const line = c.out.split("\n").find((l) => l.includes(f) && /\d+(\.\d+)?%/.test(l));
      expect(line, `a gate line for ${f}`).toBeDefined();
    }

    const victim = "src/map/find-search.ts";
    const own = ownTestPath(victim);
    expect(existsSync(join(copy, own))).toBe(true);
    unlinkSync(join(copy, own));
    const c2 = make(copy, "test-coverage");
    expect(c2.code, c2.out.slice(-3000)).not.toBe(0);
    const vline = c2.out.split("\n").find((l) => l.includes(victim) && l.includes("%"));
    expect(vline).toBeDefined();
    expect(vline).toContain("0%");
    expect(c2.out).toContain(own);

    const t2 = make(copy, "test");
    expect(t2.code).toBe(0);
    expect(t2.out.toLowerCase()).not.toContain("coverage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 1_500_000);
