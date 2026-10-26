// Held-out steps that run the repository's own make targets (01.1, 19.5). Each test works on a
// fresh copy of the committed checkout, so the checkout itself never changes. Run it with the
// working directory set to this folder, so the repository's test preload does not load.
import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = process.env.HELDOUT_SRC as string;

function copy(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  const run = Bun.spawnSync(["sh", "-c", `git -C "${SRC}" archive HEAD | tar -x -C "${dir}"`]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return dir;
}

function make(dir: string, target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe", env: process.env });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = copy();
    try {
      const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.startsWith("#"));
      const first = pure[0] as string;
      const own = first.replace(/\.tsx?$/, (ext) => `.test${ext}`);

      const t1 = make(dir, "test");
      console.log("make test (1):", t1.code, t1.out.split("\n").slice(-6).join("\n"));
      expect(t1.code).toBe(0);
      expect(t1.out).not.toMatch(/% Lines|% Funcs|pure files, \d+ under/);

      const c1 = make(dir, "test-coverage");
      console.log("make test-coverage (1):", c1.code, c1.out.split("\n").slice(-40).join("\n"));
      for (const file of pure) expect(c1.out).toMatch(new RegExp(`\\d+\\.\\d+%\\s+${file.replaceAll(".", "\\.")}`));
      expect(c1.code).toBe(0);

      unlinkSync(join(dir, own));
      const c2 = make(dir, "test-coverage");
      console.log("make test-coverage (2):", c2.code, c2.out.split("\n").slice(-40).join("\n"));
      const line = c2.out.split("\n").find((l) => l.includes(` ${first}`)) as string;
      expect(line).toMatch(/\b0(\.0+)?%/);
      expect(c2.code).not.toBe(0);
      expect(c2.out).toContain(own);

      const t2 = make(dir, "test");
      console.log("make test (2):", t2.code, t2.out.split("\n").slice(-6).join("\n"));
      expect(t2.code).toBe(0);
      expect(t2.out).not.toMatch(/% Lines|% Funcs|pure files, \d+ under/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 1_200_000 },
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = copy();
    try {
      const link = join(dir, ".claude", "agents", "test-scope.md");
      const t1 = make(dir, "test");
      console.log("checks (1):", t1.code, t1.out.split("\n").slice(-6).join("\n"));
      expect(t1.code).toBe(0);

      unlinkSync(link);
      copyFileSync(join(dir, "src", "agent", "subagents", "test-scope.md"), link);
      const t2 = make(dir, "test");
      console.log("checks (2):", t2.code, t2.out.split("\n").filter((l) => /fail|test-scope/i.test(l)).join("\n"));
      expect(t2.code).not.toBe(0);
      expect(t2.out).toContain("test-scope");

      unlinkSync(link);
      symlinkSync(join("..", "..", "src", "agent", "subagents", "test-scope.md"), link);
      const t3 = make(dir, "test");
      console.log("checks (3):", t3.code, t3.out.split("\n").slice(-6).join("\n"));
      expect(t3.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 1_200_000 },
);
