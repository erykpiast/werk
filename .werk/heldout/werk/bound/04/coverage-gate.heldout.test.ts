// Held-out user path 01.1: make test and make test-coverage, on a copy of the checkout.
// The copy is HEAD from git archive, so the deleted test file never touches the checkout.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PURE = "web/escape.ts";
const OWN_TEST = "web/escape.test.ts";

function sh(cmd: string, cwd: string) {
  const run = Bun.spawnSync(["/bin/sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

test(
  "01.1 the unit tests, then the coverage gate, then the gate with a missing own test file",
  () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-01-")));
    try {
      expect(sh(`git -C '${ROOT}' archive HEAD | tar -x -C '${dir}'`, ROOT).code).toBe(0);
      const listed = readFileSync(join(dir, "pure-files.txt"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("#"));
      expect(listed).toContain(PURE);

      const unit = sh("make test", dir);
      console.log("--- make test ---\n", unit.out.slice(-1500));
      expect(unit.code).toBe(0);
      expect(unit.out).not.toMatch(/coverage|% Lines|% Funcs/i);

      const gate = sh("make test-coverage", dir);
      console.log("--- make test-coverage ---\n", gate.out.slice(-3000));
      for (const file of listed) expect(gate.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replace(/[.]/g, "\\.")}`));
      expect(gate.code).toBe(0);

      rmSync(join(dir, OWN_TEST));
      const again = sh("make test-coverage", dir);
      console.log("--- make test-coverage, own test deleted ---\n", again.out.slice(-3000));
      expect(again.out).toMatch(/0\.00%\s+web\/escape\.ts/);
      expect(again.code).not.toBe(0);
      expect(again.out).toContain(OWN_TEST);

      const unit2 = sh("make test", dir);
      console.log("--- make test, own test deleted ---\n", unit2.out.slice(-1500));
      expect(unit2.code).toBe(0);
      expect(unit2.out).not.toMatch(/coverage/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 900_000 },
);
