import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const scripts = JSON.parse(readFileSync("package.json", "utf8"))
  .scripts as Record<string, string>;

test("the plain test script never runs the coverage gate", () => {
  expect(scripts.test).not.toContain("coverage");
  expect(scripts.test).not.toContain("coverage-gate");
});

test("the coverage script runs the gate after the unit tests", () => {
  expect(scripts["test:coverage"]).toMatch(
    /--coverage .*&& bun src\/test\/coverage-gate\.ts$/,
  );
});

test("the make test target runs only the plain test script", () => {
  const makefile = readFileSync("Makefile", "utf8");
  const target = makefile.match(/^test:.*\n((?:\t.*\n?)+)/m)?.[1] ?? "";
  expect(target).toContain("bun run test");
  expect(target).not.toContain("test:coverage");
});
