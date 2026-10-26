// 01.1 runs make in a copy of the repository, so the checkout itself is never changed.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./harness";

const copy = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
afterAll(() => rmSync(copy, { recursive: true, force: true }));

function sh(cmd: string) {
  const run = Bun.spawnSync(["/bin/sh", "-c", cmd], { cwd: copy, stdout: "pipe", stderr: "pipe", env: process.env });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const a = Bun.spawnSync(["/bin/sh", "-c", `git archive HEAD | tar -x -C ${copy}`], { cwd: ROOT });
    expect(a.exitCode).toBe(0);
    const pure = readFileSync(join(copy, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));

    const t1 = sh("make test");
    console.log("make test #1 exit", t1.code, "\n", t1.out.slice(-1500));
    expect(t1.code).toBe(0);
    expect(t1.out).not.toMatch(/coverage|% Lines|% Funcs/i);

    const c1 = sh("make test-coverage");
    console.log("make test-coverage #1 exit", c1.code, "\n", c1.out.slice(-3000));
    for (const file of pure) expect(c1.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replace(/\./g, "\\.")}`));
    expect(c1.code).toBe(0);

    const target = "web/escape.ts";
    const own = "web/escape.test.ts";
    rmSync(join(copy, own));
    const c2 = sh("make test-coverage");
    console.log("make test-coverage #2 exit", c2.code, "\n", c2.out.slice(-3000));
    const line = c2.out.split("\n").find((l) => l.includes(` ${target}`)) ?? "";
    expect(line).toMatch(/\b0\.00%|\s0%/);
    expect(c2.code).not.toBe(0);
    expect(line).toContain(own);

    const t2 = sh("make test");
    console.log("make test #2 exit", t2.code, "\n", t2.out.slice(-800));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/coverage/i);
  },
  { timeout: 600_000 },
);
