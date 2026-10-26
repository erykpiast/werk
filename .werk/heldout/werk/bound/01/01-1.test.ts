import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const p = Bun.spawnSync(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

test("01.1 coverage gate on a copy of the tree", () => {
  const copy = mkdtempSync(join(tmpdir(), "werk-01-1-"));
  try {
    cpSync(root, copy, {
      recursive: true,
      filter: (s) => !s.includes("/.git/") && !s.endsWith("/.git") && !s.includes(".werk-heldout"),
    });
    const t = make(copy, "test");
    expect(t.code).toBe(0);
    expect(t.out).toContain("0 fail");
    expect(t.out).not.toContain("% Lines");

    const c = make(copy, "test-coverage");
    expect(c.out).toMatch(/src\/toolchain\.ts\s*\|\s*100\.00\s*\|\s*100\.00/);
    expect(c.code).toBe(0);

    rmSync(join(copy, "src/toolchain.test.ts"));
    const c2 = make(copy, "test-coverage");
    expect(c2.out).toMatch(/src\/toolchain\.ts\s*\|\s*0\.00/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain("toolchain.test.ts");

    expect(make(copy, "test").code).toBe(0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 120000);
