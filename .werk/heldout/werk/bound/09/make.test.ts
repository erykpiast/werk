import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./support.ts";

setDefaultTimeout(900000);

/** Runs make in a copy of the checkout, so the deleted test file never touches the real tree. */
function make(cwd: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd });
  return {
    code: r.exitCode,
    out: `${r.stdout.toString()}${r.stderr.toString()}`,
  };
}

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const copy = mkdtempSync(join(tmpdir(), "werk-heldout-make-"));
  try {
    const cp = Bun.spawnSync([
      "rsync",
      "-a",
      "--exclude=.werk-heldout",
      "--exclude=.git",
      "--exclude=test-results",
      "--exclude=lcov.info",
      "--exclude=coverage",
      `${ROOT}/`,
      `${copy}/`,
    ]);
    expect(cp.exitCode).toBe(0);
    const pure: string[] = readFileSync(join(copy, "src/test/pure-files.ts"), "utf8")
      .split("\n")
      .map((l) => /"((?:src|client)\/[^"]+\.tsx?)"/.exec(l)?.[1])
      .filter((f): f is string => f !== undefined);
    expect(pure.length).toBeGreaterThan(3);

    const unit = make(copy, "test");
    expect(unit.out).toMatch(/\d+ pass/);
    expect(unit.out).not.toMatch(/% Lines|All files/);
    expect(unit.code).toBe(0);

    const cov = make(copy, "test-coverage");
    for (const file of pure) {
      expect(cov.out).toMatch(
        new RegExp(`^\\S+\\s+\\d+(\\.\\d+)?%\\s+${file.replace(/[.]/g, "\\.")}`, "m"),
      );
    }
    expect(cov.code).toBe(0);

    // The own test file of a file on the pure-file list.
    const target = "src/toolchain.ts";
    const own = "src/toolchain.test.ts";
    expect(pure).toContain(target);
    expect(existsSync(join(copy, own))).toBe(true);
    rmSync(join(copy, own));
    const missing = make(copy, "test-coverage");
    expect(missing.out).toMatch(
      new RegExp(`^\\S+\\s+0(\\.0)?%\\s+${target.replace(/[.]/g, "\\.")}`, "m"),
    );
    expect(missing.out).toContain(own);
    expect(missing.code).not.toBe(0);

    const again = make(copy, "test");
    expect(again.out).not.toMatch(/coverage/i);
    expect(again.code).toBe(0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
