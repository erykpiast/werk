// 01.1: the unit tests and then the coverage gate, on a clone of the checkout.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { clone, make } from "./repo.ts";

const pureList = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("01.1 make test, then make test-coverage, then a deleted own test file", () => {
  const dir = clone();
  const t1 = make(dir, "test");
  expect(t1.code).toBe(0);
  expect(t1.all).toMatch(/\d+ pass/);
  expect(t1.all).toMatch(/ 0 fail/);
  // No coverage check in the plain run.
  expect(t1.all).not.toMatch(/under 90%|% Lines|missing own test file/);

  const c1 = make(dir, "test-coverage");
  const files = pureList(dir);
  for (const f of files) expect(c1.all).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${esc(f)}`));
  expect(c1.code).toBe(0);

  const target = "src/cli/card-id.ts";
  const own = "src/cli/card-id.test.ts";
  rmSync(join(dir, own));
  const c2 = make(dir, "test-coverage");
  expect(c2.all).toMatch(new RegExp(`0\\.00%\\s+${esc(target)}`));
  expect(c2.code).not.toBe(0);
  expect(c2.all).toContain(own);

  const t2 = make(dir, "test");
  expect(t2.code).toBe(0);
  expect(t2.all).not.toMatch(/under 90%|missing own test file/);
}, 1_200_000);
