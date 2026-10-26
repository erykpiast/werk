// Held-out steps 01.1 and 19.5: the repository's checks, run on a temporary copy of this checkout.
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

const copies: string[] = [];
afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

function copyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-repo-"));
  copies.push(dir);
  const sync = Bun.spawnSync([
    "rsync",
    "-a",
    "--exclude",
    ".git",
    "--exclude",
    ".werk-heldout",
    "--exclude",
    "node_modules",
    "--exclude",
    "test-results",
    `${ROOT}/`,
    `${dir}/`,
  ]);
  expect(sync.exitCode).toBe(0);
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  return dir;
}

function make(dir: string, target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

test("01.1 the agent runs the unit tests and then the coverage gate", async () => {
  const dir = copyRepo();
  const first = make(dir, "test");
  expect(first.code).toBe(0);
  expect(first.out).toMatch(/\d+ pass/);
  expect(first.out).toMatch(/ 0 fail/);
  expect(first.out).not.toMatch(/coverage|% Lines|% Funcs/i);

  const pure = (await Bun.file(join(dir, "pure-files.txt")).text())
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const gate = make(dir, "test-coverage");
  for (const file of pure) expect(gate.out).toMatch(new RegExp(`\\d+\\.?\\d*%\\s+${file.replaceAll(".", "\\.")}`));
  expect(gate.code).toBe(0);

  unlinkSync(join(dir, "web/escape.test.ts"));
  const again = make(dir, "test-coverage");
  const line = again.out.split("\n").find((l) => l.includes(" web/escape.ts")) ?? "";
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(again.code).not.toBe(0);
  expect(again.out).toContain("web/escape.test.ts");

  const last = make(dir, "test");
  expect(last.code).toBe(0);
  expect(last.out).not.toMatch(/coverage/i);
}, 600_000);

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const dir = copyRepo();
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
}, 600_000);
