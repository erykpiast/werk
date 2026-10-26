// Held-out step 19.5: the repository checks catch a subagent copy that replaces its link.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { make, repoCopy } from "./repo-copy.ts";

const copy = repoCopy();
afterAll(() => copy.remove());

const CHECKS = ["lint", "typecheck", "test"];

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const link = join(copy.dir, ".claude", "agents", "test-scope.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const target = readlinkSync(link);
    const first = make(copy.dir, ...CHECKS);
    expect(first.code).toBe(0);

    rmSync(link);
    copyFileSync(join(copy.dir, "src", "agent", "subagents", "test-scope.md"), link);
    const broken = make(copy.dir, ...CHECKS);
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");

    rmSync(link);
    symlinkSync(target, link);
    const fixed = make(copy.dir, ...CHECKS);
    expect(fixed.code).toBe(0);
  },
  { timeout: 900_000 },
);
