// 01.1 and 19.5 change files of the repository, so they run on a copy of the checkout's HEAD in a
// temporary folder, never on the checkout itself.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CHECKOUT = dirname(import.meta.dir);
const copies: string[] = [];
afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

function copyOfHead(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-repo-"));
  copies.push(dir);
  const archive = Bun.spawnSync(["git", "archive", "HEAD"], { cwd: CHECKOUT, stdout: "pipe" });
  const untar = Bun.spawnSync(["tar", "-x", "-C", dir], { stdin: archive.stdout });
  if (untar.exitCode !== 0) throw new Error("could not copy the checkout");
  return dir;
}

function make(dir: string, target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

const report: Record<string, unknown> = {};
afterAll(() => writeFileSync(join(import.meta.dir, "repo-report.json"), JSON.stringify(report, null, 2)));

test(
  "01.1",
  () => {
    const dir = copyOfHead();
    const unit = make(dir, "test");
    report["01.1 make test"] = { code: unit.code, tail: unit.out.slice(-1500) };
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(/% (Funcs|Lines)|pure files,|under 90%/);

    const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("#"));
    const cov = make(dir, "test-coverage");
    report["01.1 make test-coverage"] = { code: cov.code, tail: cov.out.slice(-4000) };
    for (const file of pure) expect(cov.out.split("\n").some((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l))).toBe(true);
    expect(cov.code).toBe(0);

    unlinkSync(join(dir, "web/escape.test.ts"));
    const again = make(dir, "test-coverage");
    report["01.1 make test-coverage after delete"] = { code: again.code, tail: again.out.slice(-4000) };
    const line = again.out.split("\n").find((l) => l.includes("web/escape.ts")) ?? "";
    expect(line).toMatch(/\b0(\.0+)?%/);
    expect(again.code).not.toBe(0);
    expect(again.out).toContain("web/escape.test.ts");
    const unit2 = make(dir, "test");
    report["01.1 make test after delete"] = { code: unit2.code, tail: unit2.out.slice(-1500) };
    expect(unit2.code).toBe(0);
    expect(unit2.out).not.toMatch(/pure files,|under 90%/);
  },
  { timeout: 1_200_000 },
);

test(
  "19.5",
  () => {
    const dir = copyOfHead();
    const link = join(dir, ".claude/agents/test-scope.md");
    const first = make(dir, "test");
    report["19.5 first"] = { code: first.code, tail: first.out.slice(-1500) };
    expect(first.code).toBe(0);

    unlinkSync(link);
    copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
    const broken = make(dir, "test");
    report["19.5 copy"] = { code: broken.code, tail: broken.out.slice(-3000) };
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("test-scope");

    unlinkSync(link);
    symlinkSync("../../src/agent/subagents/test-scope.md", link);
    const fixed = make(dir, "test");
    report["19.5 link back"] = { code: fixed.code, tail: fixed.out.slice(-1500) };
    expect(fixed.code).toBe(0);
  },
  { timeout: 1_200_000 },
);
