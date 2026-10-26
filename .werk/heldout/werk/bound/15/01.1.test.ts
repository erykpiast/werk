// Held-out 01.1: make test, then make test-coverage, on a copy of the checkout.
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const copy = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
cpSync(ROOT, copy, {
  recursive: true,
  filter: (src) => !/\/(\.git|node_modules|\.werk-heldout)(\/|$)/.test(src.slice(ROOT.length)),
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

function make(target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
  const out = run.stdout.toString() + run.stderr.toString();
  console.log(`--- make ${target} (exit ${run.exitCode})\n${out.slice(-3000)}`);
  return { code: run.exitCode ?? -1, out };
}

const pure = readFileSync(join(ROOT, "pure-files.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));
const victim = "web/reflink.ts";
const victimTest = "web/reflink.test.ts";

test("01.1", () => {
  expect(pure).toContain(victim);
  // When the agent runs `make test` / Then the unit tests pass, without a coverage check
  const t1 = make("test");
  expect(t1.code).toBe(0);
  expect(t1.out).toMatch(/\d+ pass/);
  expect(t1.out).not.toMatch(/% Lines|coverage|% Funcs/i);
  // When the agent runs `make test-coverage`
  const c1 = make("test-coverage");
  for (const file of pure) {
    const line = c1.out.split("\n").find((l) => l.trimEnd().endsWith(file) || l.includes(`${file}  (`));
    expect(line, `line for ${file}`).toBeDefined();
    expect(line).toMatch(/\d+(\.\d+)?%/);
  }
  expect(c1.code).toBe(0);
  // When the agent deletes the own test file of a listed file, and runs make test-coverage again
  rmSync(join(copy, victimTest));
  const c2 = make("test-coverage");
  const line = c2.out.split("\n").find((l) => l.includes(` ${victim}`));
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(c2.code).not.toBe(0);
  expect(line).toContain(victimTest);
  // But `make test` still passes without a coverage failure
  const t2 = make("test");
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/coverage/i);
}, 600_000);
