// Scenarios 01.1 and 19.5: they run make targets. Each runs on its own temporary copy of the
// checkout, so a deleted test file or a replaced link never touches the real checkout.
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WERK_ROOT = join(import.meta.dir, "..");
const copies: string[] = [];
afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-make-"));
  copies.push(root);
  const dir = join(root, "repo");
  const rsync = Bun.spawnSync(
    ["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", "--exclude", "node_modules", "--exclude", "test-results", `${WERK_ROOT}/`, `${dir}/`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (rsync.exitCode !== 0) throw new Error(rsync.stderr.toString());
  return dir;
}

function make(dir: string, target: string): { code: number; out: string } {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("BUN_TEST") || name === "NODE_ENV") delete env[name];
  const run = Bun.spawnSync(["make", target], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: run.stdout.toString() + run.stderr.toString() };
}

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const dir = copy();
  const pure = Bun.file(join(dir, "pure-files.txt"));
  const list = (require("node:fs").readFileSync(join(dir, "pure-files.txt"), "utf8") as string)
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
  expect(pure.size).toBeGreaterThan(0);

  const t1 = make(dir, "test");
  expect(t1.code).toBe(0);
  expect(t1.out).toMatch(/\d+ pass/);
  expect(t1.out).toMatch(/ 0 fail/);
  expect(t1.out).not.toMatch(/coverage|% Lines|% Funcs/i);

  const c1 = make(dir, "test-coverage");
  for (const file of list) expect(c1.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replaceAll(".", "\\.")}`));
  expect(c1.code).toBe(0);

  const target = "web/escape.ts";
  rmSync(join(dir, "web/escape.test.ts"));
  const c2 = make(dir, "test-coverage");
  const line = c2.out.split("\n").find((each) => each.includes(target) && /%/.test(each));
  expect(line).toBeDefined();
  expect(line).toMatch(/\b0(\.0+)?%/);
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain("web/escape.test.ts");

  const t2 = make(dir, "test");
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/coverage/i);
}, 600_000);

test("19.5 the repository check catches a subagent copy that replaces its link", () => {
  const dir = copy();
  const link = join(dir, ".claude/agents/test-scope.md");
  const first = make(dir, "check");
  expect({ code: first.code, tail: first.out.slice(-1500) }).toMatchObject({ code: 0 });

  rmSync(link);
  copyFileSync(join(dir, "src/agent/subagents/test-scope.md"), link);
  const broken = make(dir, "check");
  expect(broken.code).not.toBe(0);
  expect(broken.out).toContain("test-scope");

  rmSync(link);
  symlinkSync(join("..", "..", "src/agent/subagents/test-scope.md"), link);
  const again = make(dir, "check");
  expect({ code: again.code, tail: again.out.slice(-1500) }).toMatchObject({ code: 0 });
}, 900_000);
