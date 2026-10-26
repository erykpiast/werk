import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function sh(cwd: string, cmd: string) {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("01.1 make test, make test-coverage, and the gate on a deleted own test", () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-ho-cov-"));
  try {
    for (const name of readdirSync(ROOT)) {
      if ([".git", "node_modules", ".werk-heldout", "coverage"].includes(name)) continue;
      cpSync(join(ROOT, name), join(dir, name), { recursive: true });
    }
    const gitInit = sh(dir, "git init -q && git add -A >/dev/null 2>&1; true");
    void gitInit;
    expect(sh(dir, "bun install --frozen-lockfile").code).toBe(0);

    const unit = sh(dir, "make test");
    expect(unit.code).toBe(0);
    expect(unit.out).not.toMatch(/coverage/i);

    const cov = sh(dir, "make test-coverage");
    expect(cov.code).toBe(0);
    const pure = [...(readFileSync2(join(dir, "src/test/pure-files.ts")).matchAll(/"(src\/[^"]+)"/g))].map((m) => m[1] as string);
    for (const f of pure) expect(cov.out).toMatch(new RegExp(`\\d+(\\.\\d+)?%\\s+${f.replace(/[.]/g, "\\.")}`));

    const victim = pure[0] as string;
    const own = victim.replace(/\.ts$/, ".test.ts");
    expect(existsSync(join(dir, own))).toBe(true);
    rmSync(join(dir, own));
    const again = sh(dir, "make test-coverage");
    expect(again.out).toMatch(new RegExp(`\\b0(\\.0+)?%\\s+${victim.replace(/[.]/g, "\\.")}`));
    expect(again.code).not.toBe(0);
    expect(again.out).toContain(own);
    expect(sh(dir, "make test").code).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600000);

import { readFileSync } from "node:fs";
function readFileSync2(path: string) {
  return readFileSync(path, "utf8");
}
