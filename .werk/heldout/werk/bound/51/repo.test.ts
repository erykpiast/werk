// Held-out repository steps: 01.1 and 19.5. Each runs the make targets in its own copy of the
// checkout (the committed tree), so the checkout itself never changes.
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
const copies: string[] = [];
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-repo-"));
  copies.push(dir);
  const run = Bun.spawnSync(["sh", "-c", `git -C "${CHECKOUT}" archive HEAD | tar -x -C "${dir}"`]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return dir;
}

function make(dir: string, target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

const pureFiles = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

test(
  "01.1",
  () => {
    const dir = copy();
    const t1 = make(dir, "test");
    expect(t1.code).toBe(0);
    expect(t1.out).toMatch(/\d+ pass/);
    expect(t1.out).toMatch(/ 0 fail/);
    expect(t1.out).not.toMatch(/pure files|% Lines|% Funcs|under 90%/i);

    const c1 = make(dir, "test-coverage");
    const files = pureFiles(dir);
    for (const file of files) {
      const line = c1.out.split("\n").find((l) => l.trimEnd().split(/\s+/).includes(file)) ?? "";
      expect(line).toMatch(/\d+(\.\d+)?%/);
    }
    expect(c1.code).toBe(0);

    const helper = files[0] as string;
    const ownTest = helper.replace(/\.tsx?$/, (ext) => `.test${ext}`);
    unlinkSync(join(dir, ownTest));
    const c2 = make(dir, "test-coverage");
    const line = c2.out.split("\n").find((l) => l.trimEnd().split(/\s+/).includes(helper)) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(c2.code).not.toBe(0);
    expect(c2.out).toContain(ownTest);

    const t2 = make(dir, "test");
    if (t2.code !== 0) console.log(t2.out.split("\n").filter((l) => /fail|error|✗|timed out/i.test(l)).slice(0, 40).join("\n"));
    expect(t2.code).toBe(0);
    expect(t2.out).not.toMatch(/pure files|% Lines|% Funcs|under 90%/i);
  },
  1_500_000,
);

test(
  "19.5",
  () => {
    const dir = copy();
    const link = join(dir, ".claude", "agents", "test-scope.md");
    const t1 = make(dir, "test");
    expect(t1.code).toBe(0);
    // Replace the link with a plain copy of the same file.
    unlinkSync(link);
    copyFileSync(join(dir, "src", "agent", "subagents", "test-scope.md"), link);
    const t2 = make(dir, "test");
    expect(t2.code).not.toBe(0);
    expect(t2.out).toContain("test-scope");
    // Put the link back.
    unlinkSync(link);
    symlinkSync(join("..", "..", "src", "agent", "subagents", "test-scope.md"), link);
    const t3 = make(dir, "test");
    expect(t3.code).toBe(0);
  },
  1_500_000,
);
