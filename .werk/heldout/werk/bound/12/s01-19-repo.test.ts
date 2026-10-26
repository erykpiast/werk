// These steps change files of the repository, so each runs on a copy of this checkout.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const copies: string[] = [];
afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

function copyRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-copy-")));
  copies.push(dir);
  const r = Bun.spawnSync(
    ["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", "--exclude", "node_modules", "--exclude", "test-results", `${REPO}/`, `${dir}/`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return dir;
}

function make(dir: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

const pureFiles = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = copyRepo();
    const unit = make(dir, "test");
    if (unit.code !== 0) console.log(unit.out.slice(-4000));
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(/% Lines|pure files, \d+ under/);
    const cov = make(dir, "test-coverage");
    const files = pureFiles(dir);
    for (const file of files) {
      const line = cov.out.split("\n").find((l) => l.trimEnd().endsWith(file) || l.includes(` ${file}  (`));
      expect(line ?? `no line for ${file}`).toMatch(/\d+(\.\d+)?%/);
    }
    if (cov.code !== 0) console.log(cov.out.slice(-4000));
    expect(cov.code).toBe(0);
    const target = "web/escape.ts";
    expect(files).toContain(target);
    unlinkSync(join(dir, "web/escape.test.ts"));
    const cov2 = make(dir, "test-coverage");
    const line = cov2.out.split("\n").find((l) => l.includes(` ${target}`)) ?? "";
    expect(line).toMatch(/\b0(\.00)?%/);
    expect(cov2.code).not.toBe(0);
    expect(cov2.out).toContain("web/escape.test.ts");
    const unit2 = make(dir, "test");
    expect(unit2.code).toBe(0);
    expect(unit2.out).not.toMatch(/coverage/i);
  },
  900_000,
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = copyRepo();
    expect(make(dir, "test").code).toBe(0);
    const link = join(dir, ".claude/agents/test-scope.md");
    unlinkSync(link);
    copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
    const bad = make(dir, "test");
    expect(bad.code).not.toBe(0);
    expect(bad.out).toContain("test-scope");
    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const good = make(dir, "test");
    if (good.code !== 0) console.log(good.out.slice(-3000));
    expect(good.code).toBe(0);
  },
  900_000,
);
