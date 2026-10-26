// 01.1: the unit tests, then the coverage gate, on a COPY of the checkout (the step deletes a test file).
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const CHECKOUT = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
}

test("01.1 make test, make test-coverage, then a missing own test file", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  try {
    const tracked = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: CHECKOUT }).stdout
      .toString()
      .split("\0")
      .filter(Boolean);
    for (const file of tracked) cpSync(join(CHECKOUT, file), join(root, file), { recursive: true, verbatimSymlinks: true });

    const unit = make(root, "test");
    expect(unit.code, unit.out).toBe(0);
    // The run reports its results without a coverage check.
    expect(unit.out).not.toMatch(/\d+\.\d%\s+src\//);
    expect(unit.out).not.toContain("File    ");

    const cov = make(root, "test-coverage");
    expect(cov.code, cov.out).toBe(0);
    const lines = cov.out.split("\n");
    for (const file of PURE_FILES) {
      const line = lines.find((l) => /^(ok|FAIL)\s+[\d.]+%\s+/.test(l) && l.includes(` ${file}`));
      expect(line, `no percentage line for ${file}`).toBeDefined();
    }

    const victim = "src/toolchain.ts";
    expect(PURE_FILES).toContain(victim);
    const own = join(root, "src/toolchain.test.ts");
    expect(existsSync(own)).toBe(true);
    rmSync(own);
    const again = make(root, "test-coverage");
    expect(again.code, again.out).not.toBe(0);
    const row = again.out.split("\n").find((l) => l.includes(victim) && /%/.test(l)) ?? "";
    expect(row).toMatch(/\b0\.0%/);
    expect(again.out).toContain("missing test file src/toolchain.test.ts");

    const unit2 = make(root, "test");
    expect(unit2.code, unit2.out).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900000);
