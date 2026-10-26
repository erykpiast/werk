// Held-out steps 01.1 and 19.5: the repository's own checks, run in a copy of the checkout so the
// checkout itself never changes.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");
let copy = "";

function sh(command: string[], cwd = copy) {
  const run = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "true" } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

beforeAll(() => {
  copy = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-")));
  const r = sh(["rsync", "-a", "--exclude", ".werk-heldout", "--exclude", "node_modules", "--exclude", ".git", `${CHECKOUT}/`, `${copy}/`], CHECKOUT);
  if (r.code !== 0) throw new Error(r.err);
  sh(["git", "init", "--quiet"]);
});

afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

const PURE = "src/cli/card-id.ts";
const OWN_TEST = "src/cli/card-id.test.ts";

test("01.1", () => {
  const list = readFileSync(join(copy, "pure-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  expect(list).toContain(PURE);

  const unit = sh(["make", "test"]);
  console.log("make test:", unit.code, unit.err.split("\n").slice(-6).join("\n"));
  expect(unit.code).toBe(0);
  expect(`${unit.out}${unit.err}`).not.toMatch(/coverage/i);

  const cov = sh(["make", "test-coverage"]);
  console.log("make test-coverage:", cov.code, cov.out);
  for (const file of list) expect(cov.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${file.replaceAll(".", "\\.")}`));
  expect(cov.code).toBe(0);

  unlinkSync(join(copy, OWN_TEST));
  const cov2 = sh(["make", "test-coverage"]);
  console.log("make test-coverage, own test gone:", cov2.code, cov2.out);
  const line = cov2.out.split("\n").find((l) => l.includes(PURE));
  expect(line).toMatch(/\b0(\.00)?%/);
  expect(cov2.code).not.toBe(0);
  expect(`${cov2.out}${cov2.err}`).toContain(OWN_TEST);

  const unit2 = sh(["make", "test"]);
  console.log("make test, own test gone:", unit2.code, unit2.err.split("\n").slice(-6).join("\n"));
  expect(unit2.code).toBe(0);
  expect(`${unit2.out}${unit2.err}`).not.toMatch(/coverage/i);
  copyFileSync(join(CHECKOUT, OWN_TEST), join(copy, OWN_TEST));
}, 900_000);

test("19.5", () => {
  const link = join(copy, ".claude/agents/test-scope.md");
  const first = sh(["make", "test"]);
  expect(first.code).toBe(0);
  unlinkSync(link);
  copyFileSync(join(copy, "src/agent/subagents/test-scope.md"), link);
  const broken = sh(["make", "test"]);
  console.log("make test with a copy:", broken.code, `${broken.out}${broken.err}`.split("\n").filter((l) => /test-scope|fail/i.test(l)).join("\n"));
  expect(broken.code).not.toBe(0);
  expect(`${broken.out}${broken.err}`).toContain("test-scope");
  unlinkSync(link);
  symlinkSync("../../src/agent/subagents/test-scope.md", link);
  const fixed = sh(["make", "test"]);
  expect(fixed.code).toBe(0);
}, 900_000);
