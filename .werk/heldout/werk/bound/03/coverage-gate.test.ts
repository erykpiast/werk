import { expect, test } from "bun:test";
import { cpSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function make(cwd: string, target: string) {
  const p = Bun.spawnSync(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

test("01.1 coverage gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-ho-"));
  const work = join(dir, "w");
  cpSync(root, work, {
    recursive: true,
    filter: (s) => !s.includes(".git/") && !s.endsWith(".git") && !s.includes(".werk-heldout"),
  });
  const t = make(work, "test");
  expect(t.code).toBe(0);
  expect(t.out).not.toMatch(/% Lines/);
  const c = make(work, "test-coverage");
  expect(c.code).toBe(0);
  expect(c.out).toMatch(/src\/toolchain\.ts\s*\|\s*[\d.]+\s*\|\s*[\d.]+/);
  rmSync(join(work, "src/toolchain.test.ts"));
  const c2 = make(work, "test-coverage");
  expect(c2.out).toMatch(/src\/toolchain\.ts\s*\|\s*0\.00\s*\|\s*0\.00/);
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain("toolchain.test.ts");
  expect(make(work, "test").code).toBe(0);
}, 120000);
