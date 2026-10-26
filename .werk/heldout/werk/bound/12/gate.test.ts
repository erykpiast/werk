/** Held-out step 01.1: make test, then make test-coverage, then a deleted test file of a pure file. */
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./support.ts";

function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], {
    cwd,
    env: { ...process.env, CI: "true" },
  });
  return {
    code: r.exitCode,
    out: `${r.stdout.toString()}${r.stderr.toString()}`,
  };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  async () => {
    // The pure-file list, read from the checkout.
    const { PURE_FILES } = await import("../src/test/pure-files.ts");
    expect(PURE_FILES.length).toBeGreaterThan(0);

    // Every run happens in a copy of the checkout, so the checkout stays as it is.
    const copy = mkdtempSync(join(tmpdir(), "werk-heldout-gate-"));
    try {
      const cp = Bun.spawnSync([
        "rsync",
        "-a",
        "--exclude",
        ".git",
        "--exclude",
        "node_modules",
        "--exclude",
        ".werk-heldout",
        "--exclude",
        "coverage",
        `${REPO}/`,
        `${copy}/`,
      ]);
      expect(cp.exitCode).toBe(0);
      symlinkSync(join(REPO, "node_modules"), join(copy, "node_modules"));
      const unit = make(copy, "test");
      expect(unit.code).toBe(0);
      expect(unit.out).toMatch(/\b0 fail/);
      expect(unit.out).not.toMatch(/% Lines/);

      const cov = make(copy, "test-coverage");
      expect(cov.code).toBe(0);
      for (const file of PURE_FILES) {
        expect(cov.out).toMatch(
          new RegExp(`^ok\\s+\\d+(\\.\\d+)?%\\s+${file.replace(/[.]/g, "\\.")}`, "m"),
        );
      }

      const victim = "src/map/thread.ts";
      expect(PURE_FILES).toContain(victim);
      const own = join(copy, victim.replace(/\.ts$/, ".test.ts"));
      expect(existsSync(own)).toBe(true);
      rmSync(own);

      const again = make(copy, "test-coverage");
      expect(again.out).toMatch(/0\.0%\s+src\/map\/thread\.ts/);
      expect(again.out).toContain("src/map/thread.test.ts");
      expect(again.code).not.toBe(0);

      const unitAgain = make(copy, "test");
      expect(unitAgain.out).not.toMatch(/missing test file/);
      expect(unitAgain.code, unitAgain.out.slice(-3000)).toBe(0);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  },
  1_500_000,
);
