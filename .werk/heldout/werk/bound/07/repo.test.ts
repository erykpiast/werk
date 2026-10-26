// Held-out steps on a copy of the repository: the unit tests and the coverage gate (01), and the
// subagent link check (19.5). Each test edits its own copy, never this checkout.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const copies: string[] = [];
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  copies.push(root);
  const dir = join(root, "werk");
  cpSync(REPO, dir, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (src) => !/\/(\.git|\.werk-heldout|test-results)$/.test(src),
  });
  return dir;
}

function make(dir: string, target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: `${run.stdout.toString()}${run.stderr.toString()}` };
}

const tail = (s: string) => s.slice(-1500);

test(
  "01.1",
  () => {
    const dir = copyRepo();
    const unit = make(dir, "test");
    if (unit.code !== 0) throw new Error(`make test failed:\n${tail(unit.out)}`);
    expect(unit.out).not.toMatch(/% Lines|% Funcs|under 90%/);
    const cov = make(dir, "test-coverage");
    const pure = Bun.file(join(dir, "pure-files.txt"));
    const files = (Bun.spawnSync(["grep", "-v", "^#", join(dir, "pure-files.txt")]).stdout.toString() || "")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(pure.size).toBeGreaterThan(0);
    for (const file of files) expect(cov.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replace(/\./g, "\\.")}`));
    expect(cov.code).toBe(0);
    unlinkSync(join(dir, "web", "escape.test.ts"));
    const again = make(dir, "test-coverage");
    expect(again.out).toMatch(/\b0(\.00)?%\s+web\/escape\.ts/);
    expect(again.code).not.toBe(0);
    expect(again.out).toContain("web/escape.test.ts");
    const unit2 = make(dir, "test");
    if (unit2.code !== 0) throw new Error(`make test failed after the delete:\n${tail(unit2.out)}`);
    expect(unit2.out).not.toMatch(/% Lines|under 90%|escape\.test\.ts/);
  },
  { timeout: 1_200_000 },
);

test(
  "19.5",
  () => {
    const dir = copyRepo();
    const first = make(dir, "test");
    if (first.code !== 0) throw new Error(`the checks do not pass before the edit:\n${tail(first.out)}`);
    const link = join(dir, ".claude", "agents", "test-scope.md");
    unlinkSync(link);
    cpSync(join(dir, "src", "agent", "subagents", "test-scope.md"), link);
    const broken = make(dir, "test");
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const fixed = make(dir, "test");
    if (fixed.code !== 0) throw new Error(`the checks do not pass after the link is back:\n${tail(fixed.out)}`);
  },
  { timeout: 1_200_000 },
);
