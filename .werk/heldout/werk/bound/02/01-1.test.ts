import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const p = Bun.spawnSync(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

test("01.1 make test, make test-coverage, then a missing own test", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-01-1-"));
  try {
    cpSync(repo, dir, {
      recursive: true,
      filter: (s) => !/\/(\.git|\.werk-heldout|coverage)(\/|$)/.test(s),
    });
    const { PURE_FILES } = require(join(dir, "src/test/pure-files.ts")) as { PURE_FILES: string[] };
    expect(PURE_FILES.length).toBeGreaterThan(0);

    const t = make(dir, "test");
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/\d+ pass/);
    expect(t.out).not.toMatch(/% Funcs|% Lines/);

    const c = make(dir, "test-coverage");
    for (const f of PURE_FILES) {
      expect(c.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/[.]/g, "\\.")}`));
    }
    expect(c.code).toBe(0);

    const victim = PURE_FILES[PURE_FILES.length - 1];
    const own = victim.replace(/\.ts$/, ".test.ts");
    expect(existsSync(join(dir, own))).toBe(true);
    rmSync(join(dir, own));

    const c2 = make(dir, "test-coverage");
    const line = c2.out.split("\n").filter((l) => l.includes(victim) && /(^|\s)0(\.0)?%/.test(l));
    expect(line.length).toBeGreaterThan(0);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain(own);

    const t2 = make(dir, "test");
    expect(t2.code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 280000);
