// Held-out user path 01.1: `make test` and `make test-coverage` on a copy of the checkout.
import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const HELPER = "src/cli/card-id.ts";
const HELPER_TEST = "src/cli/card-id.test.ts";

function make(dir: string, target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
    try {
      cpSync(ROOT, dir, {
        recursive: true,
        filter: (src) => !src.includes(".werk-heldout") && !src.endsWith("/.git"),
      });
      const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("#"));
      expect(pure).toContain(HELPER);

      const unit = make(dir, "test");
      console.log("--- make test\n", unit.out.slice(-1500));
      expect(unit.code).toBe(0);
      expect(unit.out).not.toMatch(/coverage/i);

      const cov = make(dir, "test-coverage");
      console.log("--- make test-coverage\n", cov.out);
      for (const file of pure) {
        const line = cov.out.split("\n").find((l) => l.includes(file));
        expect(line, `a line for ${file}`).toBeDefined();
        expect(line).toMatch(/\d+(\.\d+)?%/);
      }
      expect(cov.code).toBe(0);

      rmSync(join(dir, HELPER_TEST));
      const again = make(dir, "test-coverage");
      console.log("--- make test-coverage without own test\n", again.out);
      const line = again.out.split("\n").find((l) => l.includes(HELPER) && !l.includes(HELPER_TEST.slice(0, -3) + ".test")) ??
        again.out.split("\n").find((l) => l.includes(HELPER));
      expect(line).toMatch(/\b0(\.0+)?%/);
      expect(again.code).not.toBe(0);
      expect(again.out).toContain(HELPER_TEST);

      const unit2 = make(dir, "test");
      console.log("--- make test without own test\n", unit2.out.slice(-800));
      expect(unit2.code).toBe(0);
      expect(unit2.out).not.toMatch(/coverage/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  600_000,
);
