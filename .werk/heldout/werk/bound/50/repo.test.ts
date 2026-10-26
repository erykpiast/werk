// Scenarios 01.1 and 19.5: the repository's own checks, run on a copy of the checkout so the
// checkout itself never changes.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
let copy = "";

beforeAll(() => {
  copy = join(realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-"))), "werk");
  const run = Bun.spawnSync(
    [
      "rsync",
      "-a",
      "--exclude",
      ".git",
      "--exclude",
      "node_modules",
      "--exclude",
      "test-results",
      "--exclude",
      ".werk-heldout",
      `${CHECKOUT}/`,
      `${copy}/`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
});

afterAll(() => {
  if (copy !== "") rmSync(join(copy, ".."), { recursive: true, force: true });
});

function make(target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

const pureFiles = () =>
  readFileSync(join(copy, "pure-files.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const first = make("test");
    console.log(first.out.split("\n").slice(-8).join("\n"));
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/\b0 fail\b/);
    expect(first.out).not.toMatch(/% ?Lines|pure files|under 90%/i);

    const coverage = make("test-coverage");
    console.log(coverage.out.split("\n").slice(-6).join("\n"));
    const files = pureFiles();
    for (const file of files) {
      const lines = coverage.out.split("\n").filter((line) => line.includes(file) && /\d+(\.\d+)?%/.test(line));
      expect(lines.length).toBeGreaterThanOrEqual(1);
    }
    expect(coverage.code).toBe(0);

    const victim = "src/map/notes.ts";
    expect(files).toContain(victim);
    rmSync(join(copy, "src/map/notes.test.ts"));
    const again = make("test-coverage");
    const line = again.out.split("\n").find((each) => each.includes(victim) && !each.includes("notes.test.ts:"));
    console.log(line);
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(again.code).not.toBe(0);
    expect(again.out).toContain("src/map/notes.test.ts");

    const last = make("test");
    expect(last.code).toBe(0);
    expect(last.out).not.toMatch(/coverage|pure files|under 90%/i);
  },
  { timeout: 1_500_000 },
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const link = join(copy, ".claude/agents/test-scope.md");
    const shipped = join(copy, "src/agent/subagents/test-scope.md");
    expect(existsSync(link)).toBe(true);
    const clean = make("test");
    expect(clean.code).toBe(0);

    rmSync(link);
    copyFileSync(shipped, link);
    const broken = make("test");
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");

    rmSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const fixed = make("test");
    expect(fixed.code).toBe(0);
  },
  { timeout: 1_500_000 },
);
