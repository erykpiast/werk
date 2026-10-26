import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ROOT } from "./helpers.ts";

// 01.1 runs in a copy of the checkout, so deleting a test file never touches the checkout.
function copyRepo(): string {
  const dest = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  for (const name of [
    "src",
    "fake",
    "Makefile",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "tsconfig.json",
    "biome.json",
    ".bun-version",
  ]) {
    cpSync(join(ROOT, name), join(dest, name), {
      recursive: true,
      preserveTimestamps: true,
    });
  }
  symlinkSync(join(ROOT, "node_modules"), join(dest, "node_modules"));
  return dest;
}

const make = (cwd: string, target: string) => {
  const r = Bun.spawnSync(["make", target], { cwd });
  return {
    code: r.exitCode,
    out: r.stdout.toString() + r.stderr.toString(),
  };
};

test("01.1 make test, make test-coverage, and a deleted own test file", () => {
  const dir = copyRepo();
  try {
    const unit = make(dir, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(/%\s*Funcs|Uncovered Line/);
    expect(unit.out).not.toMatch(/coverage/i);

    const cov = make(dir, "test-coverage");
    for (const file of PURE_FILES) {
      expect(cov.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replace(/[.]/g, "\\.")}`));
    }
    expect(cov.code).toBe(0);

    const victim = "src/map/card-text.test.ts";
    expect(existsSync(join(dir, victim))).toBe(true);
    rmSync(join(dir, victim));
    const again = make(dir, "test-coverage");
    const line = again.out
      .split("\n")
      .find((l) => l.includes("src/map/card-text.ts"));
    expect(line).toMatch(/0(\.0+)?%/);
    expect(again.code).not.toBe(0);
    expect(again.out).toContain(victim);

    const plain = make(dir, "test");
    expect(plain.code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 240000);
