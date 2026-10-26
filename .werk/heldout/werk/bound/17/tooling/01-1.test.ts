// 01.1: The agent runs the unit tests and then the coverage gate.
import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyCheckout, sh } from "./copy.ts";

const copy = copyCheckout();
afterAll(() => copy.remove());

const pureList = () =>
  readFileSync(join(copy.dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

test("01.1", () => {
  const list = pureList();
  expect(list.length).toBeGreaterThan(0);

  const unit = sh(copy.dir, "make test");
  console.log(unit.out.slice(-1500));
  expect(unit.code).toBe(0);
  expect(unit.out).not.toMatch(/% Lines|coverage|pure files/i);

  const cov = sh(copy.dir, "make test-coverage");
  console.log(cov.out.slice(-3000));
  for (const file of list) expect(cov.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replaceAll(".", "\\.")}`));
  expect(cov.code).toBe(0);

  const target = "web/escape.ts";
  expect(list).toContain(target);
  rmSync(join(copy.dir, "web/escape.test.ts"));
  const cov2 = sh(copy.dir, "make test-coverage");
  console.log(cov2.out.slice(-3000));
  const line = cov2.out.split("\n").find((l) => l.includes(target)) ?? "";
  expect(line).toMatch(/0\.00%/);
  expect(cov2.code).not.toBe(0);
  expect(cov2.out).toContain("escape.test.ts");

  const unit2 = sh(copy.dir, "make test");
  expect(unit2.code).toBe(0);
  expect(unit2.out).not.toMatch(/coverage/i);
}, 900_000);
