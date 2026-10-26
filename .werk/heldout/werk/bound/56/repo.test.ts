// Steps that act on werk's own repository. Each one works on a copy of the checkout at HEAD, so
// the checkout itself never changes.
import { expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKOUT = join(import.meta.dir, "..");

function copyRepo(): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-repo-"))), "werk");
  const run = Bun.spawnSync([
    "sh",
    "-c",
    // The copy gets its own clone of the installed packages, so its install never touches the
    // checkout's packages or the shared package cache.
    `mkdir -p "${dir}" && git -C "${CHECKOUT}" archive HEAD | tar -x -C "${dir}" && cp -Rc "${CHECKOUT}/node_modules" "${dir}/node_modules" && touch "${dir}/node_modules/.werk-installed"`,
  ]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return dir;
}

function make(dir: string, target: string): { code: number; out: string } {
  const run = Bun.spawnSync(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? -1, out: `${run.stdout.toString()}\n${run.stderr.toString()}` };
}

const pureFiles = (dir: string) =>
  readFileSync(join(dir, "pure-files.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

test(
  "01.1 the agent runs the unit tests and then the coverage gate",
  () => {
    const dir = copyRepo();
    try {
      const first = make(dir, "test");
      expect(first.code).toBe(0);
      expect(first.out).toMatch(/\d+ pass/);
      expect(first.out).toMatch(/\b0 fail/);
      expect(first.out).not.toMatch(/coverage|% Lines|% Funcs/i);

      const files = pureFiles(dir);
      const gate = make(dir, "test-coverage");
      for (const file of files) {
        const line = gate.out.split("\n").find((each) => each.includes(file));
        expect(line, `a line for ${file}`).toBeDefined();
        expect(line).toMatch(/\d+(\.\d+)?%/);
      }
      expect(gate.code).toBe(0);

      const victim = "src/map/find.ts";
      expect(files).toContain(victim);
      unlinkSync(join(dir, "src/map/find.test.ts"));
      const again = make(dir, "test-coverage");
      const line = again.out.split("\n").find((each) => each.includes(victim) && /%/.test(each));
      expect(line).toBeDefined();
      expect(line).toMatch(/(^|\s)0(\.0+)?%/);
      expect(again.code).not.toBe(0);
      expect(again.out).toContain("src/map/find.test.ts");

      const tests = make(dir, "test");
      expect(tests.code).toBe(0);
      expect(tests.out).not.toMatch(/coverage/i);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  { timeout: 900000 },
);

test(
  "19.5 the repository check catches a subagent copy that replaces its link",
  () => {
    const dir = copyRepo();
    try {
      const link = join(dir, ".claude/agents/test-scope.md");
      const shipped = join(dir, "src/agent/subagents/test-scope.md");
      expect(existsSync(link)).toBe(true);
      const before = make(dir, "test");
      expect(before.code, before.out.slice(-3000)).toBe(0);

      unlinkSync(link);
      copyFileSync(shipped, link);
      const failed = make(dir, "test");
      expect(failed.code).not.toBe(0);
      expect(failed.out).toContain("test-scope");

      unlinkSync(link);
      symlinkSync("../../src/agent/subagents/test-scope.md", link);
      const back = make(dir, "test");
      expect(back.code, back.out.slice(-3000)).toBe(0);
    } finally {
      rmSync(join(dir, ".."), { recursive: true, force: true });
    }
  },
  { timeout: 900000 },
);
