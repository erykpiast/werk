import { expect, test } from "bun:test";
import { copyFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./repo-copy.ts";

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const dir = cloneCheckout("19");
  const ok = sh(dir, ["make", "check"]);
  console.log("19.5 make check (start) code:", ok.code, "\n", ok.out.split("\n").slice(-15).join("\n"));
  expect(ok.code).toBe(0);
  const link = join(dir, ".claude/agents/test-scope.md");
  rmSync(link);
  copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
  const bad = sh(dir, ["make", "check"]);
  const named = bad.out.split("\n").filter((l) => l.includes("test-scope"));
  console.log("19.5 make check (copy) code:", bad.code, "\n", named.slice(0, 10).join("\n"));
  expect(bad.code).not.toBe(0);
  expect(named.length).toBeGreaterThan(0);
  rmSync(link);
  symlinkSync("../../src/agent/subagents/test-scope.md", link);
  const again = sh(dir, ["make", "check"]);
  console.log("19.5 make check (link back) code:", again.code, "\n", again.out.split("\n").slice(-10).join("\n"));
  expect(again.code).toBe(0);
}, 3_000_000);
