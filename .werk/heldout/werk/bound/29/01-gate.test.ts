import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const repo = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd, env: { ...process.env, CI: "true" } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("01.1 make test, make test-coverage, then a deleted own test file", () => {
  const root = mkdtempSync(join(tmpdir(), "heldout-01-"));
  const copy = join(root, "werk");
  try {
    // The copy keeps the checkout untouched when a test file is deleted.
    expect(Bun.spawnSync(["cp", "-Rp", repo, copy]).exitCode).toBe(0);
    rmSync(join(copy, ".werk-heldout"), { recursive: true, force: true });

    const unit = make(copy, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).toMatch(/\d+ pass/);
    expect(unit.out).not.toMatch(/coverage/i);
    expect(unit.out).not.toMatch(/\.ts\s+\|/);

    const cov = make(copy, "test-coverage");
    expect(cov.code).toBe(0);
    for (const file of PURE_FILES) {
      expect(cov.out).toMatch(new RegExp(`${file.replace(/[.]/g, "\\.")}`));
      expect(cov.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replace(/[.]/g, "\\.")}`));
    }

    const victim = "src/map/fold.ts";
    expect(PURE_FILES).toContain(victim);
    const ownTest = join(copy, "src/map/fold.test.ts");
    expect(existsSync(ownTest)).toBe(true);
    rmSync(ownTest);

    const after = make(copy, "test-coverage");
    expect(after.out).toMatch(/\s0(\.0)?%\s+src\/map\/fold\.ts/);
    expect(after.code).not.toBe(0);
    expect(after.out).toContain("src/map/fold.test.ts");

    const unit2 = make(copy, "test");
    expect(unit2.code).toBe(0);
    expect(unit2.out).not.toMatch(/0(\.0+)?%\s+src\/map\/fold\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 300000);
