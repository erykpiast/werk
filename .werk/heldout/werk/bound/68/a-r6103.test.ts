import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { cloneCheckout } from "./a-repo-copy.ts";

test("61.3 tests pass on a machine with no real agent installed", () => {
  const c = cloneCheckout();
  try {
    const path = (process.env.PATH ?? "")
      .split(delimiter)
      .filter((d) => d !== "" && !existsSync(join(d, "claude")))
      .join(delimiter);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PATH: path };
    expect(Bun.spawnSync(["sh", "-c", "command -v claude"], { env }).exitCode).not.toBe(0);
    const before = c.sh(["git", "status", "--porcelain", "--ignored=no"]).out;
    const t = c.sh(["make", "test"], env);
    console.log("make test:", t.code, t.out.slice(-400));
    expect(t.code).toBe(0);
    // The command-line tests that run the fake agent are part of the passing run.
    expect(existsSync(join(c.dir, "src/test/fake-agent.test.ts"))).toBe(true);
    expect(t.out).toMatch(/\n 0 fail\n/);
    expect(c.sh(["git", "status", "--porcelain"]).out).toBe(before);
  } finally {
    c.remove();
  }
}, 1_200_000);
