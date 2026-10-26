import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, install, make, removeClones } from "./g-lib.ts";

afterEach(removeClones);

const pureList = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("01.1", async () => {
  const dir = await cloneCheckout();
  await install(dir);
  const files = pureList(dir);
  // Given the first pure helper and its own test file.
  const first = files[0] as string;
  expect(existsSync(join(dir, first))).toBe(true);
  expect(existsSync(join(dir, first.replace(/\.tsx?$/, ".test.ts")))).toBe(true);

  // make test: passes, and no coverage check in its output.
  const t1 = await make(dir, "test");
  expect(t1.code, t1.all).toBe(0);
  expect(t1.all).toMatch(/\b0 fail\b/);
  expect(t1.all).not.toMatch(/pure files, |% Lines|% Funcs|All files|under 90%/);

  // make test-coverage: one line per pure file with its line percentage, and it passes.
  const c1 = await make(dir, "test-coverage");
  for (const file of files) expect(c1.all).toMatch(new RegExp(`^\\S+\\s+\\d+(\\.\\d+)?%\\s+${escape(file)}\\b`, "m"));
  expect(c1.code, c1.all).toBe(0);

  // Delete the own test file of a pure file, and run the gate again.
  const victim = "src/cli/card-id.ts";
  const victimTest = "src/cli/card-id.test.ts";
  expect(files).toContain(victim);
  rmSync(join(dir, victimTest));
  const c2 = await make(dir, "test-coverage");
  const line = c2.all.split("\n").find((each) => new RegExp(`%\\s+${escape(victim)}\\b`).test(each)) ?? "";
  expect(line).toMatch(/\s0(\.0+)?%\s/);
  expect(c2.code).not.toBe(0);
  expect(c2.all).toContain(victimTest);

  // make test still passes, with no coverage failure.
  const t2 = await make(dir, "test");
  expect(t2.code, t2.all).toBe(0);
  expect(t2.all).not.toMatch(/pure files, |under 90%|missing own test file/);
}, 900_000);
