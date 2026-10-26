// Held-out step 61.3: the tests pass on a machine with no real agent installed.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cloneCheckout, sh } from "./a-clone.ts";

test(
  "61.3 make test passes with no claude program on PATH and leaves the working tree clean",
  () => {
    const c = cloneCheckout();
    try {
      const inst = sh(c.dir, ["bun", "install", "--frozen-lockfile"]);
      expect(inst.code).toBe(0);
      const path = (process.env.PATH ?? "")
        .split(":")
        .filter((d) => d !== "" && !existsSync(join(d, "claude")))
        .join(":");
      const which = Bun.spawnSync(["/usr/bin/which", "claude"], { env: { ...process.env, PATH: path } });
      expect(which.exitCode).not.toBe(0);

      const r = Bun.spawnSync(["make", "test"], {
        cwd: c.dir,
        env: { ...process.env, PATH: path },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 900_000,
      });
      const out = r.stdout.toString() + r.stderr.toString();
      console.log("make test exit", r.exitCode, out.split("\n").filter((l) => /\(fail\)|pass$|fail$|Ran /.test(l)).slice(-20).join("\n"));
      expect(r.exitCode).toBe(0);
      // The fake agent tests ran from their temporary projects inside the run.
      expect(existsSync(join(c.dir, "src/test/fake-agent.test.ts"))).toBe(true);

      const status = sh(c.dir, ["git", "status", "--porcelain", "--untracked-files=all"]);
      console.log("git status:", JSON.stringify(status.out));
      expect(status.out.trim()).toBe("");
    } finally {
      c.done();
    }
  },
  1_200_000,
);
