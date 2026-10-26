import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");

function sh(cwd: string, cmd: string[]) {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

test("01.1 make test, make test-coverage, then a deleted own test file", () => {
  // Work in a copy so the checkout stays unchanged.
  const copy = mkdtempSync(join(tmpdir(), "heldout-01-1-"));
  try {
    const files = Bun.spawnSync(["git", "ls-files"], { cwd: root })
      .stdout.toString()
      .split("\n")
      .filter(Boolean);
    for (const f of files) {
      if (!existsSync(join(root, f))) continue;
      mkdirSync(dirname(join(copy, f)), { recursive: true });
      cpSync(join(root, f), join(copy, f), { verbatimSymlinks: true });
    }
    symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
    Bun.spawnSync(["touch", join(copy, "node_modules/.install-stamp")]);

    // Step 1: make test passes without a coverage check.
    const t = sh(copy, ["make", "test"]);
    if (t.code !== 0) console.log(t.out.slice(-3000));
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/ 0 fail/);
    expect(t.out).not.toMatch(/% Funcs|% Lines/);

    // Step 2: coverage shows a line per pure file, and passes.
    const pure = require(join(copy, "src/test/pure-files.ts"))
      .PURE_FILES as string[];
    const c = sh(copy, ["make", "test-coverage"]);
    expect(c.code).toBe(0);
    for (const f of pure) expect(c.out).toContain(f);
    expect(c.out).toMatch(/\d+(\.\d+)?%/);

    // Step 3: delete one own test file, coverage fails with 0% and names it.
    const victim = "src/toolchain.ts";
    const own = "src/toolchain.test.ts";
    expect(existsSync(join(copy, own))).toBe(true);
    rmSync(join(copy, own));
    const c2 = sh(copy, ["make", "test-coverage"]);
    const line = c2.out
      .split("\n")
      .filter((l) => l.includes(victim) && !l.includes("|"));
    console.log(line.join("\n"));
    expect(c2.code).not.toBe(0);
    expect(line.join("\n")).toMatch(/\b0(\.0+)?%/);
    expect(c2.out).toContain(own);

    // Step 4: make test still passes.
    const t2 = sh(copy, ["make", "test"]);
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage-gate|below|threshold/i);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 1_500_000);
