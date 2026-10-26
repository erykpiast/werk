// Held-out step 01.1: make test, then make test-coverage, then delete an own test file.
// Works on a copy of the tracked tree in a temporary folder, so the checkout stays unchanged.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
let copy = "";

function make(target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
  const out = run.stdout.toString() + run.stderr.toString();
  console.log(`--- make ${target} (exit ${run.exitCode})\n${out}`);
  return { code: run.exitCode, out };
}

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "werk-heldout-01.1-"));
  const files = Bun.spawnSync(["git", "ls-files"], { cwd: root }).stdout.toString().trim().split("\n");
  for (const f of files) {
    if (f.startsWith(".werk-heldout/")) continue;
    mkdirSync(dirname(join(copy, f)), { recursive: true });
    cpSync(join(root, f), join(copy, f));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: copy });
});

afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

function pureList(): string[] {
  return readFileSync(join(copy, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

test("01.1", () => {
  // Given the werk repository with its first pure helper and that helper's own test file
  const list = pureList();
  expect(list.length).toBeGreaterThan(0);
  const helper = list[0] as string;
  const ownTest = helper.replace(/\.(tsx?)$/, ".test.$1");
  expect(existsSync(join(copy, helper))).toBe(true);
  expect(existsSync(join(copy, ownTest))).toBe(true);

  // When the agent runs `make test`
  const t1 = make("test");
  // Then the unit tests pass
  expect(t1.code).toBe(0);
  expect(t1.out).toMatch(/\b0 fail\b/);
  // And the run reports its results without a coverage check
  expect(t1.out).toMatch(/\d+ pass/);
  expect(t1.out).not.toMatch(/% Lines|% Funcs|pure files,|under 90%/);

  // When the agent runs `make test-coverage`
  const c1 = make("test-coverage");
  // Then the output shows one line for each file on the pure-file list with its line percentage
  for (const f of list) {
    const lines = c1.out.split("\n").filter((l) => l.includes(f) && /\d+(\.\d+)?%/.test(l));
    expect(lines.length).toBe(1);
  }
  // And the coverage command passes
  expect(c1.code).toBe(0);

  // When the agent deletes the own test file of a file on the pure-file list
  rmSync(join(copy, ownTest));
  // And the agent runs `make test-coverage` again
  const c2 = make("test-coverage");
  // Then the output shows 0% for that file
  const line = c2.out.split("\n").find((l) => l.includes(helper) && /%/.test(l)) ?? "";
  expect(line).toMatch(/\b0(\.0+)?%/);
  // And the coverage command fails and names the missing test file
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain(ownTest);
  // But `make test` still passes without a coverage failure
  const t2 = make("test");
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/% Lines|pure files,|under 90%|coverage threshold/i);
}, 600_000);
