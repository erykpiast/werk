import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { PURE_FILES } from "../src/test/pure-files.ts";

const ROOT = join(import.meta.dir, "..");
const SKIP = new Set([".git", "node_modules", "coverage", ".werk-heldout"]);

async function make(cwd: string, target: string) {
  const child = Bun.spawn(["make", target], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, text: `${out}\n${err}` };
}

test("01.1 make test has no coverage check; make test-coverage lists each pure file; a missing own test gives 0% and a failure that names it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "werk-heldout-01-"));
  try {
    // A copy of the checkout, so the deletion of a test file never touches the real tree.
    cpSync(ROOT, dir, {
      recursive: true,
      filter: (src) => !SKIP.has(relative(ROOT, src).split(sep)[0] as string),
    });

    const plain = await make(dir, "test");
    expect(plain.code).toBe(0);
    expect(plain.text).toMatch(/\d+ pass/);
    expect(plain.text).toMatch(/0 fail/);
    expect(plain.text).not.toContain("% Lines");
    expect(plain.text).not.toMatch(/^ok\s+\d+\.\d%\s+src\//m);

    const cov = await make(dir, "test-coverage");
    expect(cov.code).toBe(0);
    for (const file of PURE_FILES) {
      expect(cov.text).toMatch(
        new RegExp(`^ok\\s+\\d+\\.\\d%\\s+${file.replace(/[.]/g, "\\.")}`, "m"),
      );
    }

    const victim = "src/toolchain.ts";
    expect(PURE_FILES).toContain(victim);
    rmSync(join(dir, "src/toolchain.test.ts"));
    expect(existsSync(join(dir, "src/toolchain.test.ts"))).toBe(false);

    const after = await make(dir, "test-coverage");
    const line = after.text
      .split("\n")
      .find((l) => l.includes(victim) && /\d+\.\d%/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/\b0\.0%/);
    expect(after.code).not.toBe(0);
    expect(after.text).toContain("src/toolchain.test.ts");

    const still = await make(dir, "test");
    expect(still.code).toBe(0);
    expect(still.text).not.toContain("% Lines");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 600000);
