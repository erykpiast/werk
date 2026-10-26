// Held-out step 01.1: make test, then make test-coverage, then a deleted own test file.
// Runs on a copy of the checkout so the real tree stays unchanged.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
let dir = "";

function make(target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-heldout-011-"));
  const sh = Bun.spawnSync(["sh", "-c", `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`]);
  if (sh.exitCode !== 0) throw new Error(sh.stderr.toString());
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const pureFiles = () =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

test("01.1", () => {
  // When the agent runs `make test`
  const t1 = make("test");
  console.log("--- make test\n" + t1.out.slice(-1500));
  // Then the unit tests pass
  expect(t1.code).toBe(0);
  expect(t1.out).toMatch(/\b0 fail\b/);
  // And the run reports its results without a coverage check
  expect(t1.out).toMatch(/\d+ pass/);
  expect(t1.out).not.toMatch(/% Lines|pure files|under 90%/);

  // When the agent runs `make test-coverage`
  const c1 = make("test-coverage");
  console.log("--- make test-coverage\n" + c1.out);
  // Then the output shows one line for each file on the pure-file list with its line percentage
  const files = pureFiles();
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const lines = c1.out.split("\n").filter((l) => l.includes(f) && /\d+(\.\d+)?%/.test(l));
    expect({ f, n: lines.length }).toEqual({ f, n: 1 });
  }
  // And the coverage command passes
  expect(c1.code).toBe(0);

  // When the agent deletes the own test file of a file on the pure-file list
  const target = "src/cli/card-id.ts";
  const ownTest = "src/cli/card-id.test.ts";
  expect(files).toContain(target);
  rmSync(join(dir, ownTest));
  // And the agent runs `make test-coverage` again
  const c2 = make("test-coverage");
  console.log("--- make test-coverage again\n" + c2.out);
  // Then the output shows 0% for that file
  const line = c2.out.split("\n").find((l) => l.includes(target) && /%/.test(l)) ?? "";
  expect(line).toMatch(/\b0(\.0+)?%/);
  // And the coverage command fails and names the missing test file
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain(ownTest);

  // But `make test` still passes without a coverage failure
  const t2 = make("test");
  console.log("--- make test again\n" + t2.out.slice(-1500));
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/% Lines|pure files|under 90%|coverage threshold/i);
}, 600_000);
