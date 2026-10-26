import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ROOT } from "./support.ts";

const SKIP = new Set([".git", "node_modules", ".werk-heldout", "test-results"]);

async function make(dir: string, target: string) {
  const child = Bun.spawn(["make", "-C", dir, target], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, out: `${stdout}\n${stderr}` };
}

test("01.1 make test, make test-coverage, and a missing own test file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (src) => !SKIP.has(src.slice(ROOT.length + 1).split("/")[0] as string) });
    const t = await make(dir, "test");
    expect(t.code, t.out.slice(-3000)).toBe(0);
    expect(t.out).not.toMatch(/% Lines/);
    expect(t.out).not.toMatch(/FAIL\s+\d/);

    const c = await make(dir, "test-coverage");
    expect(c.code, c.out.slice(-3000)).toBe(0);
    for (const f of PURE_FILES) {
      const hits = c.out.split("\n").filter((l) => /^(ok  |FAIL)\s+[\d.]+%\s/.test(l) && l.includes(`  ${f}`));
      expect(hits, `no gate line for ${f}`).toHaveLength(1);
    }

    const victim = "src/md/escape.ts";
    expect(PURE_FILES).toContain(victim);
    const own = join(dir, "src/md/escape.test.ts");
    expect(existsSync(own)).toBe(true);
    rmSync(own);
    const c2 = await make(dir, "test-coverage");
    expect(c2.code).not.toBe(0);
    const line = c2.out.split("\n").find((l) => l.includes(`  ${victim}`) && /^(ok  |FAIL)/.test(l));
    expect(line, c2.out.slice(-2000)).toBeDefined();
    expect(line).toMatch(/\b0\.0%/);
    expect(line).toContain("src/md/escape.test.ts");
    const t2 = await make(dir, "test");
    expect(t2.code, t2.out.slice(-3000)).toBe(0);
    expect(t2.out).not.toMatch(/% Lines/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 590000);
