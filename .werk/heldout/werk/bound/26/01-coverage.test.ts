import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./repo-copy.ts";

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const dir = cloneCheckout("01");
  const unit = sh(dir, ["make", "test"]);
  console.log("01.1 make test code:", unit.code, "\n", unit.out.split("\n").slice(-12).join("\n"));
  expect(unit.code).toBe(0);
  expect(unit.out).not.toMatch(/% Lines|coverage/i);
  const pure = readFileSync(join(dir, "pure-files.txt"), "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const cov = sh(dir, ["make", "test-coverage"]);
  console.log("01.1 make test-coverage code:", cov.code, "\n", cov.out.split("\n").slice(-40).join("\n"));
  for (const file of pure) {
    const line = cov.out.split("\n").find((l) => l.includes(file));
    expect(line, file).toBeDefined();
    expect(line).toMatch(/\d+(\.\d+)?%/);
  }
  expect(cov.code).toBe(0);
  const victim = "src/cli/card-id.ts";
  rmSync(join(dir, "src/cli/card-id.test.ts"));
  const cov2 = sh(dir, ["make", "test-coverage"]);
  console.log("01.1 make test-coverage after delete code:", cov2.code, "\n", cov2.out.split("\n").slice(-40).join("\n"));
  const line = cov2.out.split("\n").find((l) => l.includes(victim));
  expect(line).toBeDefined();
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(cov2.code).not.toBe(0);
  expect(cov2.out).toContain("src/cli/card-id.test.ts");
  const unit2 = sh(dir, ["make", "test"]);
  console.log("01.1 make test after delete code:", unit2.code, "\n", unit2.out.split("\n").slice(-8).join("\n"));
  expect(unit2.code).toBe(0);
  expect(unit2.out).not.toMatch(/coverage/i);
}, 1_500_000);
