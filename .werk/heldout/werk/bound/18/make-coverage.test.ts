import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ROOT } from "./support.ts";

async function make(cwd: string, target: string) {
  const p = Bun.spawn(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code, all: stdout + stderr };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  async () => {
    // Work on a copy, so the checkout is never changed.
    const dir = mkdtempSync(join(tmpdir(), "werk-heldout-cov-"));
    try {
      const cp = Bun.spawnSync(
        ["rsync", "-a", "--exclude", ".git", "--exclude", "coverage", "--exclude", ".werk-heldout", `${ROOT}/`, `${dir}/`],
      );
      expect(cp.exitCode).toBe(0);

      const unit = await make(dir, "test");
      expect(unit.code).toBe(0);
      expect(unit.all).toMatch(/\d+ pass/);
      expect(unit.all).not.toMatch(/% Funcs|% Lines/);

      const cov = await make(dir, "test-coverage");
      for (const file of PURE_FILES) {
        const line = cov.all.split("\n").find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l) && /^(ok|FAIL)/.test(l));
        expect(line, `no gate line for ${file}`).toBeDefined();
      }
      expect(cov.all).not.toMatch(/^FAIL/m);
      expect(cov.code).toBe(0);

      // Delete the own test file of a pure file.
      const victim = "src/tickets/spec-stories.ts";
      const test = "src/tickets/spec-stories.test.ts";
      rmSync(join(dir, test));
      expect(existsSync(join(dir, test))).toBe(false);
      const again = await make(dir, "test-coverage");
      const line = again.all.split("\n").find((l) => l.includes(victim) && /^(ok|FAIL)/.test(l));
      expect(line).toMatch(/\b0(\.0)?%/);
      expect(line).toContain(test);
      expect(again.code).not.toBe(0);

      const unit2 = await make(dir, "test");
      expect(unit2.all).not.toMatch(/FAIL\s+\d/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  1_200_000,
);
