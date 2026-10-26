import { expect, test } from "bun:test";
import { copyFileSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./clone.ts";

// The "repository checks" are `make test`, where the subagent link check runs.
test("19.5 a copy that replaces a subagent link fails the checks", () => {
  const { dir, done } = cloneCheckout();
  try {
    const link = join(dir, ".claude/agents/test-scope.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const target = readlinkSync(link);
    const r1 = sh(dir, ["make", "test"]);
    console.log("[checks #1] exit", r1.code, r1.out.slice(-200));
    expect(r1.code).toBe(0);

    copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), `${link}.tmp`);
    rmSync(link);
    copyFileSync(`${link}.tmp`, link);
    rmSync(`${link}.tmp`);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    const r2 = sh(dir, ["make", "test"]);
    console.log("[checks #2] exit", r2.code, r2.out.split("\n").filter((l) => /test-scope|fail/i.test(l)).slice(0, 20).join("\n"));
    expect(r2.code).not.toBe(0);
    expect(r2.out).toContain("test-scope");

    rmSync(link);
    symlinkSync(target, link);
    const r3 = sh(dir, ["make", "test"]);
    console.log("[checks #3] exit", r3.code, r3.out.slice(-200));
    expect(r3.code).toBe(0);
  } finally {
    done();
  }
}, 1_800_000);
