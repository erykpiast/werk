// Held-out step 19.5: the repository checks catch a subagent copy that replaces its link.
import { expect, test } from "bun:test";
import { copyFileSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, make } from "./a-clone.ts";

// Reading: "the repository checks" are the unit tests run by `make test`, which hold the link check.
test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const c = cloneCheckout();
    try {
      const link = join(c.dir, ".claude/agents/test-scope.md");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      const target = readlinkSync(link);
      const first = make(c.dir, "test");
      console.log("first exit", first.code, first.out.split("\n").filter((l) => /fail|error/i.test(l)).slice(0, 40).join("\n"));
      expect(first.code).toBe(0);

      rmSync(link);
      copyFileSync(join(c.dir, "src/agent/subagents/test-scope.md"), link);
      const broken = make(c.dir, "test");
      console.log("with copy exit", broken.code, broken.out.split("\n").filter((l) => /test-scope|subagent/.test(l)).join("\n"));
      expect(broken.code).not.toBe(0);
      expect(broken.out).toContain("test-scope");

      rmSync(link);
      symlinkSync(target, link);
      const again = make(c.dir, "test");
      console.log("link back exit", again.code);
      expect(again.code).toBe(0);
    } finally {
      c.done();
    }
  },
  1_800_000,
);
