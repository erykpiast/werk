import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ROOT } from "./helpers.ts";

// Runs the make targets on a copy of the checkout, so the deleted test file is the copy's.
function sh(cwd: string, cmd: string) {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd, env: process.env });
  return {
    code: r.exitCode,
    out: r.stdout.toString() + r.stderr.toString(),
  };
}

test("01.1 make test, make test-coverage, and a missing own test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-01-"));
  try {
    mkdirSync(dir, { recursive: true });
    expect(sh(ROOT, `git archive HEAD | tar -x -C ${dir}`).code).toBe(0);
    expect(sh(dir, "make install").code).toBe(0);

    const plain = sh(dir, "make test");
    expect(plain.code).toBe(0);
    expect(plain.out).toContain("0 fail");
    expect(plain.out).not.toMatch(/threshold|coverage gate/i);
    expect(plain.out).not.toContain("% Lines");

    const cov = sh(dir, "make test-coverage");
    expect(cov.out).toMatch(/ok\s+[\d.]+%\s+src\/tickets\/spec-stories\.ts/);
    for (const f of PURE_FILES) expect(cov.out).toMatch(new RegExp(`ok\\s+[\\d.]+%\\s+${f.replace(/\./g, "\\.")}`));
    expect(cov.code).toBe(0);

    expect(sh(dir, "rm src/tickets/spec-stories.test.ts").code).toBe(0);
    const again = sh(dir, "make test-coverage");
    expect(again.out).toMatch(/FAIL\s+0\.0%\s+src\/tickets\/spec-stories\.ts/);
    expect(again.code).not.toBe(0);
    expect(again.out).toContain("spec-stories.test.ts");

    const plain2 = sh(dir, "make test");
    expect(plain2.code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600000);
