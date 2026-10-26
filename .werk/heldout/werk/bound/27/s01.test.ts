// Step 01.1: make test, make test-coverage, and a deleted own test file. Runs in a copy of the checkout.
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd, env: { ...process.env, CI: "true" } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("01.1 make test, make test-coverage, deleted own test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "heldout-01-"));
  try {
    const files = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString().split("\n").filter(Boolean);
    for (const f of files) {
      if (f.startsWith(".werk-heldout/")) continue;
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      cpSync(join(ROOT, f), join(dir, f), { verbatimSymlinks: true });
    }
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
    const plain = make(dir, "test");
    expect(plain.code, plain.out).toBe(0);
    expect(plain.out).not.toMatch(/coverage gate|Coverage/i);
    const cov = make(dir, "test-coverage");
    expect(cov.code, cov.out).toBe(0);
    const pure = (await_import()).PURE_FILES;
    for (const f of pure) expect(cov.out, `line for ${f}`).toContain(f);
    const victim = "src/map/rollup.test.ts";
    expect((await_import()).PURE_FILES).toContain("src/map/rollup.ts");
    rmSync(join(dir, victim));
    expect(existsSync(join(dir, victim))).toBe(false);
    const broken = make(dir, "test-coverage");
    expect(broken.code, broken.out).not.toBe(0);
    expect(broken.out).toMatch(/FAIL\s+0(\.0+)?%\s+src\/map\/rollup\.ts/);
    expect(broken.out).toContain("src/map/rollup.test.ts");
    const plain2 = make(dir, "test");
    expect(plain2.code, plain2.out).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600000);

function await_import(): { PURE_FILES: readonly string[] } {
  return require(join(ROOT, "src/test/pure-files.ts"));
}
