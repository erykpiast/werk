import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const REPO = join(import.meta.dir, "..");

/** A copy of the checkout in a temp folder, so a deleted test file never touches the checkout. */
function copyRepo(): string {
  const dest = mkdtempSync(join(tmpdir(), "werk-heldout-make-"));
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: REPO }).stdout.toString().split("\n").filter(Boolean);
  for (const f of tracked) {
    if (!existsSync(join(REPO, f))) continue;
    cpSync(join(REPO, f), join(dest, f), { recursive: true, verbatimSymlinks: true });
  }
  symlinkSync(join(REPO, "node_modules"), join(dest, "node_modules"));
  Bun.spawnSync(["touch", join(dest, "node_modules", ".install-stamp")]);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dest });
  return dest;
}

const make = (cwd: string, target: string) =>
  Bun.spawnSync(["make", target], { cwd, env: { ...process.env, CI: "true" } });
const text = (r: ReturnType<typeof make>) => r.stdout.toString() + r.stderr.toString();

test("01.1 make test, make test-coverage, and a missing own test file", () => {
  const dir = copyRepo();
  try {
    const t = make(dir, "test");
    expect(t.exitCode, text(t).slice(-2000)).toBe(0);
    expect(text(t)).not.toMatch(/coverage/i);

    const c = make(dir, "test-coverage");
    const out = text(c);
    expect(c.exitCode, out.slice(-2000)).toBe(0);
    for (const file of PURE_FILES) {
      const line = out.split("\n").find((l) => l.includes(file) && /\d+(\.\d+)?\s*%/.test(l));
      expect(line, `no percentage line for ${file}`).toBeDefined();
    }

    const victim = "src/md/escape.ts";
    expect(PURE_FILES).toContain(victim);
    rmSync(join(dir, "src/md/escape.test.ts"));
    const c2 = make(dir, "test-coverage");
    const out2 = text(c2);
    expect(c2.exitCode).not.toBe(0);
    expect(out2.split("\n").find((l) => l.includes(victim) && /\b0(\.0+)?\s*%/.test(l)) ?? out2.slice(-1500)).toContain(victim);
    expect(out2).toContain("src/md/escape.test.ts");
    const t2 = make(dir, "test");
    expect(t2.exitCode, text(t2).slice(-2000)).toBe(0);
    expect(text(t2)).not.toMatch(/coverage/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 900_000);
