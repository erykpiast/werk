import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

/** The checkout is copied: the test deletes a test file, and no file outside .werk-heldout may change. */
function copyTree(): string {
  const dest = mkdtempSync(join(tmpdir(), "werk-heldout-make-"));
  const r = Bun.spawnSync(
    ["rsync", "-a", "--exclude", ".git", "--exclude", ".werk-heldout", "--exclude", "coverage", `${ROOT}/`, `${dest}/`],
  );
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return dest;
}

function make(dir: string, target: string) {
  const r = Bun.spawnSync(["make", target], { cwd: dir, env: { ...process.env, CI: "true" } });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

test("01.1 the agent runs the unit tests and then the coverage gate", () => {
  const dir = copyTree();
  try {
    const list = [...readFileSync(join(dir, "src/test/pure-files.ts"), "utf8").matchAll(/"((?:src|client)\/[^"]+\.ts)"/g)].map((m) => m[1] as string);
    expect(list.length).toBeGreaterThan(0);

    const unit = make(dir, "test");
    expect(unit.code, unit.out.slice(-1500)).toBe(0);
    expect(unit.out).toMatch(/\d+ pass/);
    expect(unit.out).not.toMatch(/% Lines|Uncovered Line|coverage gate/i);

    const cov = make(dir, "test-coverage");
    expect(cov.code, cov.out.slice(-2500)).toBe(0);
    for (const file of list) {
      const line = cov.out.split("\n").find((l) => l.includes(file));
      expect(line, `no coverage line for ${file}`).toBeDefined();
      expect(line).toMatch(/\d+(\.\d+)?\s*%?/);
    }

    const victim = "src/md/escape.ts";
    const test = join(dir, "src/md/escape.test.ts");
    expect(existsSync(test)).toBe(true);
    rmSync(test);
    const broken = make(dir, "test-coverage");
    const vline = broken.out.split("\n").filter((l) => l.includes(victim));
    expect(vline.some((l) => /\b0(\.0+)?\s*%?\b/.test(l)), broken.out.slice(-2500)).toBe(true);
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain("src/md/escape.test.ts");

    const again = make(dir, "test");
    expect(again.code, again.out.slice(-1500)).toBe(0);
    expect(again.out).not.toMatch(/coverage gate/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600000);
