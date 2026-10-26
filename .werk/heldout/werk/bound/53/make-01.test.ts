import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
let dir = "";

/** A copy of the checkout, so deleting a test file never touches the checkout. */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  const skip = new Set(["node_modules", ".git", "coverage", "test-results", "dist", ".werk-heldout"]);
  cpSync(CHECKOUT, dir, {
    verbatimSymlinks: true,
    recursive: true,
    filter: (src) => !skip.has(src.slice(CHECKOUT.length + 1).split("/")[0] ?? ""),
  });
  Bun.spawnSync(["cp", "-cR", join(CHECKOUT, "node_modules"), join(dir, "node_modules")]);
  // The locked packages are in place, so the install step has nothing to do.
  const stamp = join(dir, "node_modules", ".install-stamp");
  writeFileSync(stamp, "");
  const later = new Date(Date.now() + 60_000);
  utimesSync(stamp, later, later);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function make(target: string) {
  const r = Bun.spawnSync(["make", target], {
    cwd: dir,
    env: { ...process.env, CI: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
}
const tail = (s: string) => s.slice(-1500);
const COVERAGE_TABLE = /% Lines|Uncovered Line/;

test("01.1 step 1: make test passes and reports no coverage check", () => {
  const plain = make("test");
  expect(plain.out).not.toMatch(COVERAGE_TABLE);
  expect(plain.code, tail(plain.out)).toBe(0);
}, 1_500_000);

test("01.1 step 2: make test-coverage prints one line per pure file and passes", () => {
  const covered = make("test-coverage");
  for (const file of PURE_FILES) {
    const row = covered.out.split("\n").find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l) && !l.includes("|"));
    expect(row, `no gate line for ${file}`).toBeDefined();
  }
  expect(covered.code, tail(covered.out)).toBe(0);
}, 1_500_000);

test("01.1 step 3: a deleted own test file gives 0%, a failing gate that names it, and make test still passes", () => {
  const victim = "src/toolchain.ts";
  expect(PURE_FILES).toContain(victim);
  unlinkSync(join(dir, "src/toolchain.test.ts"));
  const broken = make("test-coverage");
  const line = broken.out.split("\n").find((l) => l.includes(victim) && !l.includes("|"));
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(broken.out).toContain("src/toolchain.test.ts");
  expect(broken.code).not.toBe(0);
  const again = make("test");
  expect(again.out).not.toMatch(COVERAGE_TABLE);
  expect(again.code, tail(again.out)).toBe(0);
}, 1_500_000);
