// 01.1: run on a copy of the checkout, so the checkout never changes.
import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");

function sh(cwd: string, command: string): { code: number; out: string } {
  const run = Bun.spawnSync(["/bin/sh", "-c", `${command} 2>&1`], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-")));
    try {
      expect(sh(REPO, `git archive HEAD | tar -x -C '${dir}'`).code).toBe(0);
      expect(sh(REPO, `cp -cR node_modules '${dir}/node_modules' || cp -R node_modules '${dir}/node_modules'`).code).toBe(0);
      sh(dir, "git init -q && git add -A && git -c user.name=t -c user.email=t@t.invalid commit -qm copy");
      const list = Bun.spawnSync(["/bin/sh", "-c", "grep -v '^#' pure-files.txt | grep -v '^$'"], { cwd: dir })
        .stdout.toString()
        .split("\n")
        .filter(Boolean);
      const first = list[0] as string;
      const ownTest = first.replace(/\.ts$/, ".test.ts");

      const t1 = sh(dir, "make test");
      console.log("failures:\n", t1.out.split("\n").filter((l) => /\(fail\)|^error:/.test(l)).join("\n"));
      console.log("make test tail:\n", t1.out.split("\n").slice(-8).join("\n"));
      expect(t1.code).toBe(0);
      expect(t1.out).not.toMatch(/coverage|% Lines|% Funcs/i);

      const c1 = sh(dir, "make test-coverage");
      console.log("make test-coverage tail:\n", c1.out.split("\n").slice(-6).join("\n"));
      for (const file of list) {
        const line = c1.out.split("\n").find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l));
        expect(line, `a line for ${file}`).toBeDefined();
      }
      expect(c1.code).toBe(0);

      unlinkSync(join(dir, ownTest));
      const c2 = sh(dir, "make test-coverage");
      const line = c2.out.split("\n").find((l) => l.includes(first) && /%/.test(l)) ?? "";
      console.log("after delete:", line);
      expect(line).toMatch(/\b0(\.0+)?%/);
      expect(c2.code).not.toBe(0);
      expect(c2.out).toContain(ownTest);

      const t2 = sh(dir, "make test");
      console.log("failures 2:\n", t2.out.split("\n").filter((l) => /\(fail\)|^error:/.test(l)).join("\n"));
      console.log("make test (2) tail:\n", t2.out.split("\n").slice(-8).join("\n"));
      expect(t2.code).toBe(0);
      expect(t2.out).not.toMatch(/coverage/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 1_800_000 },
);
