import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { REPO } from "./support.ts";

/** A copy of the repository's tracked files, with the installed packages cloned, so a test can delete files. */
function copyRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-gate-")));
  const tracked = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO })
    .stdout.toString()
    .split("\0")
    .filter((f) => f !== "");
  for (const file of tracked) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    Bun.spawnSync(["cp", "-P", join(REPO, file), join(root, file)]);
  }
  const cloned = Bun.spawnSync([
    "cp",
    "-Rc",
    join(REPO, "node_modules"),
    join(root, "node_modules"),
  ]);
  if (cloned.exitCode !== 0) {
    Bun.spawnSync([
      "cp",
      "-R",
      join(REPO, "node_modules"),
      join(root, "node_modules"),
    ]);
  }
  return root;
}

function make(root: string, target: string) {
  const run = Bun.spawnSync(["make", target], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, out: `${run.stdout}${run.stderr}` };
}

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const root = copyRepo();
  try {
    const unit = make(root, "test");
    expect(unit.code).toBe(0);
    expect(unit.out).toMatch(/\d+ pass/);
    expect(unit.out).not.toMatch(/% Funcs|% Lines/);
    expect(unit.out).not.toMatch(/^ok\s+\d+\.\d%/m);

    const cov = make(root, "test-coverage");
    for (const file of PURE_FILES) {
      const line = cov.out
        .split("\n")
        .find((l) => /^(ok|FAIL|fail)\s/i.test(l.trim()) && l.includes(file));
      expect(line, `a gate line for ${file}`).toBeDefined();
      expect(line).toMatch(/\d+(\.\d+)?%/);
    }
    expect(cov.code).toBe(0);

    const victim = "src/map/thread.ts";
    expect(PURE_FILES).toContain(victim);
    rmSync(join(root, "src/map/thread.test.ts"));
    const again = make(root, "test-coverage");
    const line = again.out
      .split("\n")
      .find((l) => l.includes(victim) && /%/.test(l) && !l.includes("|"));
    expect(line).toMatch(/\b0(\.0)?%/);
    expect(again.out).toContain("src/map/thread.test.ts");
    expect(again.code).not.toBe(0);

    const unitAgain = make(root, "test");
    expect(unitAgain.code).toBe(0);
    expect(unitAgain.out).not.toMatch(/^ok\s+\d+\.\d%/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900000);
