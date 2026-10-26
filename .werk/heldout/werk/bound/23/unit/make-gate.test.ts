import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../../src/test/pure-files.ts";

const ROOT = join(import.meta.dir, "..", "..");
const KEEP = [
  "src", "client", "e2e", "fake", ".bun-version", "Makefile", "package.json", "bun.lock", "bunfig.toml",
  "tsconfig.json", "biome.json", "vite.config.ts", "playwright.config.ts", ".gitignore", "AGENTS.md", "CLAUDE.md", "README.md", ".claude",
];

/** Runs make in a copy of the checkout, so the deletion of a test file never touches the checkout. */
function make(dir: string, target: string) {
  const env = { ...process.env };
  const result = Bun.spawnSync(["make", target], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() };
}

test("01.1 make test, make test-coverage, and a missing own test file", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-make-"));
  try {
    for (const name of KEEP) {
      if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dir, name), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    }
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));

    const plain = make(dir, "test");
    if (plain.code !== 0) console.log(plain.out.slice(-3500));
    expect(plain.code).toBe(0);
    expect(plain.out).not.toMatch(/coverage/i);

    const covered = make(dir, "test-coverage");
    if (covered.code !== 0) console.log(covered.out.slice(-6000));
    expect(covered.code).toBe(0);
    for (const file of PURE_FILES) {
      const line = covered.out.split("\n").find((l) => l.includes(file));
      expect(line, `no line for ${file}`).toBeDefined();
      expect(line).toMatch(/\d+(\.\d+)?%/);
    }

    const target = "src/map/stale-list.ts";
    expect(PURE_FILES).toContain(target);
    rmSync(join(dir, "src/map/stale-list.test.ts"));
    const broken = make(dir, "test-coverage");
    expect(broken.code).not.toBe(0);
    const row = broken.out.split("\n").find((l) => l.includes(target));
    expect(row).toMatch(/\b0(\.0+)?%/);
    expect(broken.out).toContain("src/map/stale-list.test.ts");

    expect(make(dir, "test").code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 900000);
