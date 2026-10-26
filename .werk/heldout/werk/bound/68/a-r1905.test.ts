import { expect, test } from "bun:test";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout } from "./a-repo-copy.ts";

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const c = cloneCheckout();
  try {
    const link = join(c.dir, ".claude/agents/test-scope.md");
    const t1 = c.sh(["make", "test"]);
    console.log("checks (1):", t1.code, t1.out.slice(-200));
    expect(t1.code).toBe(0);
    const text = readFileSync(link, "utf8");
    rmSync(link);
    writeFileSync(link, text);
    const t2 = c.sh(["make", "test"]);
    console.log("checks (copy):", t2.code, t2.out.split("\n").filter((l) => l.includes("test-scope")).join("\n"));
    expect(t2.code).not.toBe(0);
    expect(t2.out).toContain("test-scope");
    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const t3 = c.sh(["make", "test"]);
    console.log("checks (3):", t3.code, t3.out.slice(-200));
    expect(t3.code).toBe(0);
  } finally {
    c.remove();
  }
}, 1_200_000);
