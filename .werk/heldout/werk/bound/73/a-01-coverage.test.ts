// Step 01.1: make test, then the coverage gate, then a pure file without its own test file.
import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make, removeCopies } from "./a-helpers.ts";

afterAll(removeCopies);

const pureList = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

test("01.1 unit tests, coverage gate, and a missing own test file", () => {
  const dir = cloneCheckout();
  const t1 = make(dir, "test");
  console.log("--- make test (1) tail\n", t1.out.slice(-1500));
  expect(t1.code).toBe(0);
  expect(t1.out).not.toMatch(/% Lines|% Funcs|pure files, \d+ under/);

  const c1 = make(dir, "test-coverage");
  console.log("--- make test-coverage (1) tail\n", c1.out.slice(-3000));
  const files = pureList(dir);
  for (const file of files) {
    const line = c1.out.split("\n").filter((l) => l.endsWith(file) || l.includes(`${file}  (`));
    expect(line.length, `line for ${file}`).toBe(1);
    expect(line[0]).toMatch(/\d+\.\d+%/);
  }
  expect(c1.code).toBe(0);

  const victim = "src/cli/card-id.ts";
  rmSync(join(dir, "src/cli/card-id.test.ts"));
  const c2 = make(dir, "test-coverage");
  console.log("--- make test-coverage (2) tail\n", c2.out.slice(-1500));
  const line = c2.out.split("\n").find((l) => l.includes(` ${victim}`)) ?? "";
  console.log("victim line:", line);
  expect(line).toMatch(/\b0\.00%/);
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain("card-id.test.ts");

  const t2 = make(dir, "test");
  console.log("--- make test (2) tail\n", t2.out.slice(-800));
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/pure files, \d+ under|% Lines|missing own test file/);
});
