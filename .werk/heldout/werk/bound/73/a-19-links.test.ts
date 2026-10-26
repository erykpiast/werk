// Step 19.5: the repository checks catch a subagent copy that replaces its link.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make, removeCopies, sh } from "./a-helpers.ts";

afterAll(removeCopies);

test("19.5 a copy in place of the test-scope link fails the checks", () => {
  const dir = cloneCheckout();
  const link = join(dir, ".claude/agents/test-scope.md");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const first = make(dir, "test");
  expect(first.code).toBe(0);

  const text = readFileSync(link, "utf8");
  rmSync(link);
  copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
  expect(lstatSync(link).isSymbolicLink()).toBe(false);
  expect(readFileSync(link, "utf8")).toBe(text);
  const broken = make(dir, "test");
  const failLines = broken.out.split("\n").filter((l) => /fail|test-scope/i.test(l) && !l.startsWith("(pass)"));
  console.log(failLines.slice(0, 20).join("\n"));
  expect(broken.code).not.toBe(0);
  expect(broken.out).toContain("test-scope");

  rmSync(link);
  expect(sh(dir, ["git", "checkout", "--", ".claude/agents/test-scope.md"]).code).toBe(0);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const again = make(dir, "test");
  expect(again.code).toBe(0);
});
