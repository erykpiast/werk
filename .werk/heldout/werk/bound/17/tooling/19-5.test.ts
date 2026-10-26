// 19.5: The repository check catches a subagent copy that replaces its link.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { copyCheckout, sh } from "./copy.ts";

const copy = copyCheckout();
afterAll(() => copy.remove());

test("19.5", () => {
  const link = join(copy.dir, ".claude/agents/test-scope.md");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const first = sh(copy.dir, "make check");
  console.log(`first: ${first.code}\n${first.out.slice(-600)}`);
  expect(first.code).toBe(0);

  rmSync(link);
  copyFileSync(join(copy.dir, "src/agent/subagents/test-scope.md"), link);
  const broken = sh(copy.dir, "make check");
  console.log(`broken: ${broken.code}\n${broken.out.split("\n").filter((l) => /test-scope|fail/i.test(l)).join("\n")}`);
  expect(broken.code).not.toBe(0);
  expect(broken.out).toContain("test-scope");

  rmSync(link);
  symlinkSync("../../src/agent/subagents/test-scope.md", link);
  const fixed = sh(copy.dir, "make check");
  console.log(`fixed: ${fixed.code}`);
  expect(fixed.code).toBe(0);
}, 1_800_000);
