import { afterEach, expect, test } from "bun:test";
import { lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, install, make, removeClones } from "./g-lib.ts";

afterEach(removeClones);

// The repository checks that cover the subagent links are the unit tests (scripts/subagent-links.test.ts), run by `make test`.
test("19.5", async () => {
  const dir = await cloneCheckout();
  await install(dir);
  const link = join(dir, ".claude/agents/test-scope.md");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const t0 = await make(dir, "test");
  expect(t0.code, t0.all).toBe(0);

  const text = readFileSync(link, "utf8");
  rmSync(link);
  writeFileSync(link, text);
  const t1 = await make(dir, "test");
  expect(t1.code).not.toBe(0);
  expect(t1.all).toContain("test-scope");

  rmSync(link);
  symlinkSync("../../src/agent/subagents/test-scope.md", link);
  const t2 = await make(dir, "test");
  expect(t2.code, t2.all).toBe(0);
}, 900_000);
