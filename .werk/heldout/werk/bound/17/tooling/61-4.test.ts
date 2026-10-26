// 61.4: The coverage gate fails below 90% on a pure file and passes again at 90% or above.
import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyCheckout, sh } from "./copy.ts";

const copy = copyCheckout();
afterAll(() => copy.remove());

const FILE = "src/map/rules.ts";
const TESTS = "src/map/rules.test.ts";

test("61.4", () => {
  expect(sh(copy.dir, "make test-coverage").code).toBe(0);

  // Delete every unit test of the file but the first group, so the file loses most of its coverage.
  const text = readFileSync(join(copy.dir, TESTS), "utf8");
  const starts = [...text.matchAll(/^(describe|test)\(/gm)].map((m) => m.index as number);
  expect(starts.length).toBeGreaterThan(1);
  writeFileSync(join(copy.dir, TESTS), text.slice(0, starts[1]));

  const unit = sh(copy.dir, "make test");
  expect(unit.code).toBe(0);

  const cov = sh(copy.dir, "make test-coverage");
  const line = cov.out.split("\n").find((l) => l.includes(` ${FILE}`)) ?? "";
  console.log(line);
  expect(cov.code).not.toBe(0);
  const percent = Number(/([\d.]+)%/.exec(line)?.[1]);
  expect(percent).toBeLessThan(90);
  expect(line).toMatch(/FAIL/);

  expect(sh(copy.dir, `git checkout -- ${TESTS}`).code).toBe(0);
  expect(sh(copy.dir, "make test-coverage").code).toBe(0);
}, 900_000);
