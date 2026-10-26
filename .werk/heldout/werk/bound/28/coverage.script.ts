import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ownTestPath } from "../src/test/coverage-report.ts";


const expect = (value: unknown, message?: string) => ({
  toBe: (x: unknown) => assert.equal(value, x, message),
  not: {
    toBe: (x: unknown) => assert.notEqual(value, x, message),
    toMatch: (re: RegExp) => assert.ok(!re.test(String(value)), message ?? `unexpected ${re}`),
  },
  toMatch: (re: RegExp) => assert.ok(re.test(String(value)), message ?? `expected ${re}`),
  toContain: (x: string) => assert.ok(String(value).includes(x), message ?? `expected ${x}`),
});

const REPO = join(import.meta.dir, "..");

/** Runs make in a copy of the checkout, so deleting a test file never touches the checkout. */
function make(dir: string, target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
}

function run() {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-cov-"));
  try {
    cpSync(REPO, dir, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !/(^|\/)(\.git|node_modules|\.werk-heldout|dist|coverage|test-results)$/.test(src),
    });
    symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
    Bun.spawnSync(["touch", join(dir, "node_modules", ".install-stamp")]);

    const unit = make(dir, "test");
    expect(unit.code, unit.out.slice(-2000)).toBe(0);
    expect(unit.out).not.toMatch(/^(ok|FAIL)\s+\d+\.\d%/m);

    const cov = make(dir, "test-coverage");
    expect(cov.code, cov.out.slice(-2000)).toBe(0);
    for (const file of PURE_FILES) {
      expect(cov.out, file).toMatch(new RegExp(`^ok\\s+\\d+\\.\\d%\\s+${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
    }

    const victim = PURE_FILES.find((f) => existsSync(join(dir, ownTestPath(f)))) as string;
    rmSync(join(dir, ownTestPath(victim)));
    const failed = make(dir, "test-coverage");
    expect(failed.code).not.toBe(0);
    expect(failed.out).toMatch(new RegExp(`FAIL\\s+0\\.0%\\s+${victim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(failed.out).toContain(ownTestPath(victim));
    const unitAgain = make(dir, "test");
    expect(unitAgain.code, unitAgain.out.slice(-1500)).toBe(0);
    expect(unitAgain.out).not.toMatch(/FAIL\s+0\.0%/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
run();
console.log("01.1 ok");
