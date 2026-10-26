// Held-out step 01.1: the agent runs make test and make test-coverage on a copy of the werk
// repository, so the deleted test file never leaves the checkout.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function sh(cmd: string[], cwd: string): { code: number; out: string } {
  const run = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-repo-"));
  try {
    expect(sh(["sh", "-c", `git -C '${ROOT}' archive HEAD | tar -x -C '${dir}'`], dir).code).toBe(0);
    const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));

    const unit = sh(["make", "test"], dir);
    console.log("make test (tail):\n" + unit.out.slice(-600));
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(/% Lines|pure files|coverage/i);

    const cov = sh(["make", "test-coverage"], dir);
    console.log("make test-coverage:\n" + cov.out.slice(-3000));
    for (const file of pure) {
      const line = cov.out.split("\n").find((l) => l.trim().endsWith(file) || l.includes(`  ${file}`));
      expect({ file, line: line !== undefined && /\d+(\.\d+)?%/.test(line) }).toEqual({ file, line: true });
    }
    expect(cov.code).toBe(0);

    unlinkSync(join(dir, "web", "escape.test.ts"));
    const cov2 = sh(["make", "test-coverage"], dir);
    console.log("make test-coverage after delete:\n" + cov2.out.slice(-3000));
    const escapeLine = cov2.out.split("\n").find((l) => l.includes("web/escape.ts")) ?? "";
    expect(escapeLine).toMatch(/\b0(\.00)?%/);
    expect(cov2.code).not.toBe(0);
    expect(cov2.out).toContain("web/escape.test.ts");

    const unit2 = sh(["make", "test"], dir);
    console.log("make test after delete (tail):\n" + unit2.out.slice(-600));
    expect(unit2.code).toBe(0);
    expect(unit2.out).not.toMatch(/% Lines|under 90%|missing own test file/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 900000);
