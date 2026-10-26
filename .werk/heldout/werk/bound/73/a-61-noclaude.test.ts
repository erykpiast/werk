// Step 61.3: make test passes with no real agent on PATH, and leaves the working tree unchanged.
import { afterAll, expect, test } from "bun:test";
import { cloneCheckout, removeCopies, sh } from "./a-helpers.ts";

afterAll(removeCopies);

test("61.3 make test with no claude on PATH", () => {
  const dir = cloneCheckout();
  expect(sh(dir, ["/bin/sh", "-c", "command -v claude"]).code).not.toBe(0);
  const run = sh(dir, ["make", "test"]);
  console.log(run.out.slice(-600));
  expect(run.code).toBe(0);
  // The tests that run the command line with the fake agent use a scripted temporary project.
  const grep = sh(dir, ["grep", "-rl", "--include=*.test.ts", "script(", "src"]);
  console.log("tests that install a fake script:", grep.out.trim().split("\n").length);
  expect(grep.out).toContain("src/");
  const status = sh(dir, ["git", "status", "--porcelain", "--untracked-files=all"]).out.trim();
  console.log("git status:", JSON.stringify(status));
  expect(status).toBe("");
});
