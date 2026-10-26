// werk/01 step 01.1: the unit tests, then the coverage gate, on a copy of the checkout.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const ROOT = join(import.meta.dir, "..");

async function make(cwd: string, target: string) {
  const child = Bun.spawn(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, out: `${stdout}\n${stderr}` };
}

const failedTests = (out: string) => out.split("\n").filter((l) => l.startsWith("(fail)"));

test("01.1 the unit tests run without coverage, the gate lists each pure file, a missing own test fails the gate", async () => {
  const copy = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  try {
    // The copy never changes the checkout: the test file is deleted in the copy only.
    const sync = Bun.spawnSync(["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", `${ROOT}/`, `${copy}/`]);
    expect(sync.exitCode).toBe(0);

    const unit = await make(copy, "test");
    expect(unit.out).toContain("pass");
    expect({ code: unit.code, failed: failedTests(unit.out) }).toEqual({ code: 0, failed: [] });
    expect(unit.out).not.toMatch(/% Lines|% Funcs/);

    const gate = await make(copy, "test-coverage");
    for (const file of PURE_FILES) {
      expect(gate.out).toMatch(new RegExp(`^ok\\s+\\d+(\\.\\d+)?%\\s+${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    }
    expect({ code: gate.code, failed: failedTests(gate.out) }).toEqual({ code: 0, failed: [] });

    const victim = "src/map/thread.ts";
    const ownTest = "src/map/thread.test.ts";
    expect(existsSync(join(copy, ownTest))).toBe(true);
    rmSync(join(copy, ownTest));
    const broken = await make(copy, "test-coverage");
    expect(broken.out).toMatch(new RegExp(`^\\S+\\s+0(\\.0+)?%\\s+${victim.replace(".", "\\.")}.*$`, "m"));
    expect(broken.out).toContain(ownTest);
    expect(broken.code).not.toBe(0);

    const after = await make(copy, "test");
    expect({ code: after.code, failed: failedTests(after.out) }).toEqual({ code: 0, failed: [] });
    expect(after.out).not.toMatch(/coverage/i);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 900000);
