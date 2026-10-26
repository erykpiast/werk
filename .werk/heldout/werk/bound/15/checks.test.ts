// Step 01.1: make test and make test-coverage, run on a copy of the checkout.
// The copy leaves out .werk-heldout, so the run cannot start itself again, and the checkout keeps its test files.
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const ROOT = join(import.meta.dir, "..");

function copyCheckout(): string {
  const dest = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  const tracked = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT }).stdout.toString().split("\0").filter(Boolean);
  for (const file of tracked) {
    if (!existsSync(join(ROOT, file))) continue;
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    cpSync(join(ROOT, file), join(dest, file), { preserveTimestamps: true });
  }
  symlinkSync(join(ROOT, "node_modules"), join(dest, "node_modules"));
  return dest;
}

async function make(cwd: string, target: string) {
  const proc = Bun.spawn(["make", target], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: `${stdout}\n${stderr}` };
}

test("01.1 the agent runs the unit tests and then the coverage gate", async () => {
  const copy = copyCheckout();
  try {
    const unit = await make(copy, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).toMatch(/\b0 fail\b/);
    expect(unit.out).not.toMatch(/% Lines/);
    expect(unit.out).not.toMatch(/^(ok|FAIL)\s+\S+%\s+src\//m);

    const gate = await make(copy, "test-coverage");
    for (const file of PURE_FILES) {
      expect(gate.out).toMatch(new RegExp(`^\\s*\\S*\\s+\\d+(\\.\\d+)?%\\s+${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));
    }
    expect(gate.code).toBe(0);

    const target = "src/map/thread.ts";
    expect(PURE_FILES).toContain(target);
    rmSync(join(copy, "src/map/thread.test.ts"));
    const again = await make(copy, "test-coverage");
    expect(again.out).toMatch(/\b0(\.0)?%\s+src\/map\/thread\.ts/);
    expect(again.code).not.toBe(0);
    expect(again.out).toContain("src/map/thread.test.ts");

    const unitAgain = await make(copy, "test");
    expect(unitAgain.code).toBe(0);
    expect(unitAgain.out).not.toMatch(/coverage/i);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}, 600000);
