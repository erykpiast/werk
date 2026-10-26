// Step 61.4: the gate fails below 90% on one pure file and passes again once the tests are back.
import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make, removeCopies, sh } from "./a-helpers.ts";

afterAll(removeCopies);

test("61.4 coverage gate below and above 90%", () => {
  const dir = cloneCheckout();
  const c0 = make(dir, "test-coverage");
  expect(c0.code).toBe(0);

  // Delete every unit test of src/cli/args.ts but the first one.
  const testFile = join(dir, "src/cli/args.test.ts");
  const lines = readFileSync(testFile, "utf8").split("\n");
  const second = lines.findIndex((l, i) => i > 21 && l.startsWith("test("));
  writeFileSync(testFile, `${lines.slice(0, second).join("\n")}\n`);

  const t = make(dir, "test");
  expect(t.code).toBe(0);

  const c1 = make(dir, "test-coverage");
  const line = c1.out.split("\n").find((l) => l.includes(" src/cli/args.ts")) ?? "";
  console.log("args line:", line, "\n", c1.out.slice(-300));
  expect(c1.code).not.toBe(0);
  const percent = Number(/(\d+\.\d+)%/.exec(line)?.[1]);
  expect(percent).toBeLessThan(90);
  expect(line).toMatch(/FAIL/);

  expect(sh(dir, ["git", "checkout", "--", "src/cli/args.test.ts"]).code).toBe(0);
  const c2 = make(dir, "test-coverage");
  console.log(c2.out.split("\n").find((l) => l.includes(" src/cli/args.ts")));
  expect(c2.code).toBe(0);
});
