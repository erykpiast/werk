// Scenarios 01.1 and 19.5: the repository's own checks, run with make on a copy of the checkout,
// so the checkout itself never changes.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const copies: string[] = [];
afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

function copyCheckout(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  copies.push(dir);
  const archive = Bun.spawnSync(["sh", "-c", `git -C "${CHECKOUT}" archive HEAD | tar -x -C "${dir}"`]);
  if (archive.exitCode !== 0) throw new Error(archive.stderr.toString());
  return dir;
}

function make(dir: string, ...targets: string[]) {
  const run = Bun.spawnSync(["make", ...targets], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

const MIN = 60_000;

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = copyCheckout();
    const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(pure.length).toBeGreaterThan(0);

    const unit = make(dir, "test");
    expect(unit.code).toBe(0);
    expect(unit.out + unit.err).not.toMatch(/coverage|% of lines|pure files/i);

    const cov = make(dir, "test-coverage");
    for (const file of pure) {
      const line = cov.out.split("\n").find((l) => l.includes(file));
      expect(line).toBeDefined();
      expect(line).toMatch(/\d+(\.\d+)?%/);
    }
    expect(cov.code).toBe(0);

    const target = "web/escape.ts";
    expect(pure).toContain(target);
    unlinkSync(join(dir, "web/escape.test.ts"));
    const after = make(dir, "test-coverage");
    const line = after.out.split("\n").find((l) => l.includes(target)) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(after.code).not.toBe(0);
    expect(after.out + after.err).toContain("web/escape.test.ts");

    const unitAgain = make(dir, "test");
    expect(unitAgain.code).toBe(0);
    expect(unitAgain.out + unitAgain.err).not.toMatch(/coverage|% of lines/i);
  },
  30 * MIN,
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = copyCheckout();
    const link = join(dir, ".claude/agents/test-scope.md");
    const shipped = join(dir, "src/agent/subagents/test-scope.md");
    expect(existsSync(link)).toBe(true);
    const checks = ["lint", "typecheck", "test"];
    const pass = make(dir, ...checks);
    expect(pass.code).toBe(0);

    unlinkSync(link);
    copyFileSync(shipped, link);
    const fail = make(dir, ...checks);
    expect(fail.code).not.toBe(0);
    expect(fail.out + fail.err).toContain("test-scope");

    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const again = make(dir, ...checks);
    expect(again.code).toBe(0);
  },
  30 * MIN,
);
