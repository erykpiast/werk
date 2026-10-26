// The repository checks, run with make in a fresh copy of the checkout (never in the checkout).
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COPY_SH = join(import.meta.dir, "copy.sh");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")), "werk");
  made.push(dir);
  const run = Bun.spawnSync(["sh", COPY_SH, dir, "install"], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`copy failed: ${run.stderr}`);
  return dir;
}

function make(dir: string, target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = copy();
    const unit = make(dir, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).toMatch(/\b0 fail\b/);
    expect(unit.out).not.toMatch(/coverage|% Lines|pure files/i);
    const cov = make(dir, "test-coverage");
    const listed = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    const outLines = cov.out.split("\n");
    for (const file of listed) {
      const line = outLines.find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l));
      expect(line, `no percentage line for ${file}`).toBeDefined();
    }
    expect(cov.code).toBe(0);
    unlinkSync(join(dir, "web/escape.test.ts"));
    const cov2 = make(dir, "test-coverage");
    const line = cov2.out.split("\n").find((l) => l.includes("web/escape.ts") && /%/.test(l)) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(cov2.code).not.toBe(0);
    expect(cov2.out).toContain("web/escape.test.ts");
    const unit2 = make(dir, "test");
    expect(unit2.code).toBe(0);
    expect(unit2.out).not.toMatch(/coverage/i);
  },
  { timeout: 900_000 },
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = copy();
    expect(make(dir, "test").code).toBe(0);
    const link = join(dir, ".claude/agents/test-scope.md");
    unlinkSync(link);
    copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
    const broken = make(dir, "test");
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    expect(make(dir, "test").code).toBe(0);
  },
  { timeout: 900_000 },
);
