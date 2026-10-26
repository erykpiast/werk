// Held-out test for step 01.1. It works on a copy of the checkout, never the checkout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
let copy = "";

function make(target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

function pureList(): string[] {
  return readFileSync(join(copy, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

const testOf = (f: string) => f.replace(/(\.[^./]+)$/, ".test$1");

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "werk-heldout-01-1-"));
  const r = Bun.spawnSync(["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", "--exclude", "node_modules", `${ROOT}/`, `${copy}/`]);
  if (r.exitCode !== 0) throw new Error("copy failed");
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

test("01.1", () => {
  // Given: the repository has a pure helper with its own test file.
  const files = pureList();
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) expect(existsSync(join(copy, testOf(f)))).toBe(true);

  // When make test: unit tests pass, no coverage check in the output.
  const t1 = make("test");
  console.log("--- make test ---\n" + t1.out.slice(-1500));
  expect(t1.code).toBe(0);
  expect(t1.out).not.toMatch(/coverage|% Lines|pure files/i);

  // When make test-coverage: one line per listed file with a line percentage; it passes.
  const c1 = make("test-coverage");
  console.log("--- make test-coverage ---\n" + c1.out);
  for (const f of files) {
    const lines = c1.out.split("\n").filter((l) => /\d+(\.\d+)?%\s+(\S+)/.exec(l)?.[2] === f);
    expect(lines.length).toBe(1);
  }
  expect(c1.code).toBe(0);

  // When the agent deletes the own test file of a listed file and runs make test-coverage again.
  const victim = files[0] as string;
  rmSync(join(copy, testOf(victim)));
  const c2 = make("test-coverage");
  console.log("--- make test-coverage (after delete) ---\n" + c2.out);
  const line = c2.out.split("\n").find((l) => /\d+(\.\d+)?%\s+(\S+)/.exec(l)?.[2] === victim) ?? "";
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain(testOf(victim));

  // But make test still passes without a coverage failure.
  const t2 = make("test");
  console.log("--- make test (after delete) ---\n" + t2.out.slice(-1500));
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/coverage|pure files|missing own test/i);
}, 600_000);
