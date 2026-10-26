import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PURE_FILES } from "../../src/test/pure-files.ts";
import { ownTestPath } from "../../src/test/coverage-report.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

async function make(cwd: string, target: string) {
  const proc = Bun.spawn(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: stdout + stderr };
}

// 01.1. The checkout is cloned, so the deletion of a test file never touches it.
test("01.1 make test, make test-coverage, and a deleted own test file", async () => {
  const work = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  try {
    const dir = join(work, "werk");
    const copy = Bun.spawnSync(["bash", "-c", `mkdir -p "${dir}" && cd "${CHECKOUT}" && tar --exclude=./.git --exclude=./.werk-heldout --exclude=./coverage --exclude=./test-results -cf - . | tar -xf - -C "${dir}"`]);
    expect(copy.exitCode).toBe(0);
    expect(existsSync(join(dir, "node_modules"))).toBe(true);

    const plain = await make(dir, "test");
    expect(plain.code, plain.out).toBe(0);
    expect(plain.out).toMatch(/\d+ pass/);
    expect(plain.out).not.toMatch(/% Funcs|% Lines|Uncovered Line/);

    const cov = await make(dir, "test-coverage");
    expect(cov.code, cov.out).toBe(0);
    for (const file of PURE_FILES) {
      const line = cov.out.split("\n").find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l) && !l.includes("|"));
      expect(line, `a gate line for ${file}`).toBeDefined();
    }

    const victim = "src/map/removal-rules.ts";
    expect(PURE_FILES).toContain(victim);
    rmSync(join(dir, ownTestPath(victim)));
    const gone = await make(dir, "test-coverage");
    const victimLine = gone.out.split("\n").find((l) => l.includes(victim) && !l.includes("|")) ?? "";
    expect(victimLine).toContain("0%");
    expect(gone.code).not.toBe(0);
    expect(gone.out).toContain(ownTestPath(victim));

    const again = await make(dir, "test");
    expect(again.code, again.out).toBe(0);
    expect(again.out).not.toMatch(/coverage/i);
    expect(readdirSync(dir)).toContain("Makefile");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 900000);
