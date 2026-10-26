// Held-out steps 01.1 and 19.5: the repository checks, run on a copy of the checkout so the real
// checkout never changes.
import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");

function sh(cmd: string, cwd: string): { code: number; out: string } {
  const r = Bun.spawnSync(["/bin/sh", "-c", `${cmd} 2>&1`], { cwd, stdout: "pipe", env: { ...process.env, CI: "true" } });
  return { code: r.exitCode, out: r.stdout.toString() };
}

function copy(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-")));
  const r = sh(`git -C '${CHECKOUT}' archive HEAD | tar -x -C '${dir}'`, CHECKOUT);
  if (r.code !== 0) throw new Error(r.out);
  sh("git init -q && git add -A && git -c user.name=t -c user.email=t@t.invalid commit -qm copy", dir);
  return dir;
}

const LONG = 1_200_000;

test(
  "01.1 make test, then the coverage gate, then a deleted own test file",
  () => {
    const dir = copy();
    try {
      const t1 = sh("make test", dir);
      console.log("make test (1):", t1.code, t1.out.slice(-600));
      expect(t1.code).toBe(0);
      expect(t1.out).not.toMatch(/% Lines|pure files,|coverage/i);

      const pure = (Bun.spawnSync(["cat", "pure-files.txt"], { cwd: dir }).stdout.toString())
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.startsWith("#"));
      const c1 = sh("make test-coverage", dir);
      console.log("make test-coverage (1):", c1.code, c1.out.slice(-3000));
      for (const file of pure) expect(c1.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replace(/\./g, "\\.")}\\b`));
      expect(c1.code).toBe(0);

      const victim = "web/escape.ts";
      unlinkSync(join(dir, "web/escape.test.ts"));
      const c2 = sh("make test-coverage", dir);
      console.log("make test-coverage (2):", c2.code, c2.out.split("\n").filter((l) => l.includes("escape")).join("\n"));
      const line = c2.out.split("\n").find((l) => l.includes(`  ${victim}`)) ?? "";
      expect(line).toMatch(/\b0(\.0+)?%/);
      expect(c2.code).not.toBe(0);
      expect(c2.out).toContain("web/escape.test.ts");

      const t2 = sh("make test", dir);
      console.log("make test (2):", t2.code, t2.out.slice(-400));
      expect(t2.code).toBe(0);
      expect(t2.out).not.toMatch(/% Lines|pure files,|coverage/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  LONG,
);

test(
  "19.5 the repository checks catch a subagent copy that replaces its link",
  () => {
    const dir = copy();
    try {
      const base = sh("make test", dir);
      console.log("checks (1):", base.code, base.out.slice(-300));
      expect(base.code).toBe(0);

      const link = join(dir, ".claude/agents/test-scope.md");
      unlinkSync(link);
      copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
      const broken = sh("make test", dir);
      console.log("checks (2):", broken.code, broken.out.split("\n").filter((l) => /test-scope|fail/i.test(l)).join("\n"));
      expect(broken.code).not.toBe(0);
      expect(broken.out).toContain("test-scope");

      unlinkSync(link);
      symlinkSync("../../src/agent/subagents/test-scope.md", link);
      const again = sh("make test", dir);
      console.log("checks (3):", again.code, again.out.slice(-300));
      expect(again.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  LONG,
);
