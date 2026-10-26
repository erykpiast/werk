// 01.1: The agent runs the unit tests and then the coverage gate.
// Runs in a copy of the checkout, so the deletion of a test file never touches the checkout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
let copy = "";

function make(target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
  const out = run.stdout.toString() + run.stderr.toString();
  return { code: run.exitCode ?? -1, out };
}

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  cpSync(ROOT, copy, {
    recursive: true,
    filter: (src) => !/\/(\.git|node_modules|\.werk-heldout)(\/|$)/.test(src.slice(ROOT.length)),
  });
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

test("01.1", () => {
  // Given the werk repository with its first pure helper and that helper's own test file
  const list = readFileSync(join(copy, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  expect(list.length).toBeGreaterThan(0);
  for (const f of list) expect(existsSync(join(copy, f.replace(/(\.[^./]+)$/, ".test$1")))).toBe(true);

  // When the agent runs `make test`
  const t1 = make("test");
  console.log("--- make test ---\n", t1.out.slice(-1500));
  // Then the unit tests pass
  expect(t1.code).toBe(0);
  // And the run reports its results without a coverage check
  expect(t1.out).toMatch(/\d+ pass/);
  expect(t1.out).not.toMatch(/% Lines|coverage|pure files/i);

  // When the agent runs `make test-coverage`
  const c1 = make("test-coverage");
  console.log("--- make test-coverage ---\n", c1.out.slice(-3000));
  // Then the output shows one line for each file on the pure-file list with its line percentage
  for (const f of list) {
    const lines = c1.out.split("\n").filter((l) => l.trimEnd().endsWith(f) || l.includes(`${f}  (`));
    expect(lines.length, f).toBe(1);
    expect(lines[0]).toMatch(/\d+(\.\d+)?%/);
  }
  // And the coverage command passes
  expect(c1.code).toBe(0);

  // When the agent deletes the own test file of a file on the pure-file list
  const victim = list[0] as string;
  const victimTest = victim.replace(/(\.[^./]+)$/, ".test$1");
  rmSync(join(copy, victimTest));
  // And the agent runs `make test-coverage` again
  const c2 = make("test-coverage");
  console.log("--- make test-coverage (after delete) ---\n", c2.out.slice(-3000));
  const line = c2.out.split("\n").find((l) => l.includes(` ${victim}`)) ?? "";
  // Then the output shows 0% for that file
  expect(line).toMatch(/\b0(\.0+)?%/);
  // And the coverage command fails and names the missing test file
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain(victimTest);

  // But `make test` still passes without a coverage failure
  const t2 = make("test");
  console.log("--- make test (after delete) ---\n", t2.out.slice(-1500));
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/coverage|missing own test file/i);
}, 600_000);
