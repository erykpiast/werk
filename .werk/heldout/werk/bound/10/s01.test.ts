// Held-out step 01.1: make test and make test-coverage on a copy of the checkout, so a deleted
// test file never touches the checkout itself.
import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function copyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-repo-"));
  const files = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString().split("\n").filter(Boolean);
  for (const f of files) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  return dir;
}

function make(dir: string, target: string) {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
}

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = copyRepo();
    try {
      const unit = make(dir, "test");
      console.log(
        `make test exit ${unit.code}: ${unit.out
          .split("\n")
          .filter((l) => /^\s*\d+ (pass|fail)|\(fail\)/.test(l))
          .join(" | ")}`,
      );
      expect(unit.code).toBe(0);
      expect(unit.out).toMatch(/\d+ pass/);
      expect(unit.out).not.toMatch(/% Lines|% Funcs|coverage/i);

      const pure = readFileSync(join(dir, "pure-files.txt"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && !l.startsWith("#"));
      const cov = make(dir, "test-coverage");
      console.log(`make test-coverage exit ${cov.code}:\n${cov.out}`);
      const lines = cov.out.split("\n");
      for (const file of pure) expect(lines.some((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l))).toBe(true);
      expect(cov.code).toBe(0);

      rmSync(join(dir, "src/cli/card-id.test.ts"));
      const again = make(dir, "test-coverage");
      const line = again.out.split("\n").find((l) => l.includes("src/cli/card-id.ts")) ?? "";
      console.log(`after delete exit ${again.code}: ${line}`);
      expect(line).toMatch(/\b0(\.0+)?%/);
      expect(again.code).not.toBe(0);
      expect(again.out).toContain("src/cli/card-id.test.ts");

      const unitAgain = make(dir, "test");
      console.log(`make test again exit ${unitAgain.code}`);
      expect(unitAgain.code).toBe(0);
      expect(unitAgain.out).not.toMatch(/coverage/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  { timeout: 600000 },
);
