import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { make, repoCopy } from "./repo-copy.ts";

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const dir = repoCopy();
  const listed = readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const first = listed[0] as string;
  const firstTest = first.replace(/(\.[^./]+)$/, ".test$1");

  const unit = make(dir, "test");
  expect(unit.code).toBe(0);
  expect(unit.out).toMatch(/\d+ pass/);
  expect(unit.out).toMatch(/\b0 fail/);
  expect(unit.out).not.toMatch(/% Lines|% Funcs|pure files|coverage/i);

  const cov = make(dir, "test-coverage");
  for (const file of listed) {
    const line = cov.out.split("\n").find((l) => l.trimEnd().endsWith(` ${file}`) || l.includes(` ${file}  (`));
    expect(line, `a line for ${file}`).toBeDefined();
    expect(line).toMatch(/\d+(\.\d+)?%/);
  }
  expect(cov.code).toBe(0);

  rmSync(join(dir, firstTest));
  const again = make(dir, "test-coverage");
  const line = again.out.split("\n").find((l) => l.includes(` ${first}`));
  expect(line).toBeDefined();
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(again.code).not.toBe(0);
  expect(again.out).toContain(firstTest);

  const unit2 = make(dir, "test");
  expect(unit2.code).toBe(0);
  expect(unit2.out).not.toMatch(/% Lines|pure files|under 90%|own test file/i);
}, 900000);
