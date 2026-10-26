import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { CHECKOUT } from "./support.ts";

// The deletion happens in a copy of the checkout, never in the checkout itself.
const run = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(args, { cwd, env: { ...process.env, CI: "true" } });
  return { code: r.exitCode, out: `${r.stdout}${r.stderr}` };
};

test("01.1 make test, then make test-coverage, then a missing own test file", () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  const copy = join(root, "werk");
  try {
    expect(run(CHECKOUT, "rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", "--exclude", "coverage", `${CHECKOUT}/`, `${copy}/`).code).toBe(0);

    const plain = run(copy, "make", "test");
    expect(plain.code).toBe(0);
    expect(plain.out).toMatch(/\d+ pass/);
    expect(plain.out).toMatch(/\b0 fail/);
    expect(plain.out).not.toMatch(/% Lines|coverage/i);

    const cov = run(copy, "make", "test-coverage");
    for (const file of PURE_FILES) {
      const line = cov.out.split("\n").filter((l) => /^(ok|FAIL|fail)\s+\d+(\.\d+)?%\s+/.test(l) && l.trim().endsWith(file));
      expect(line.length).toBe(1);
    }
    expect(cov.code).toBe(0);

    const victim = "src/chat/turn-queue.ts";
    expect(PURE_FILES).toContain(victim);
    unlinkSync(join(copy, "src/chat/turn-queue.test.ts"));
    const after = run(copy, "make", "test-coverage");
    const victimLine = after.out.split("\n").find((l) => l.includes(victim) && /%/.test(l) && !l.includes("|"));
    expect(victimLine).toMatch(/\b0(\.0)?%/);
    expect(after.code).not.toBe(0);
    expect(after.out).toContain("src/chat/turn-queue.test.ts");

    const again = run(copy, "make", "test");
    expect(again.code).toBe(0);
    expect(again.out).not.toMatch(/% Lines|coverage/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 1_200_000);
