import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

// The step deletes a test file, so the whole run happens on a copy of the checkout.
test("01.1 make test, make test-coverage, and a deleted own test file", async () => {
  const root = mkdtempSync(join(tmpdir(), "werk-heldout-make-"));
  const copy = join(root, "copy");
  try {
    cpSync(ROOT, copy, {
      verbatimSymlinks: true,
      recursive: true,
      filter: (src) =>
        !/\/(\.git|node_modules|\.werk-heldout|coverage|test-results)(\/|$)/.test(src),
    });
    symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
    const make = async (target: string) => {
      const child = Bun.spawn(["make", target], { cwd: copy, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, text: stdout + stderr };
    };
    const plain = await make("test");
    if (plain.code !== 0) throw new Error(plain.text.slice(-4000));
    expect(plain.text).toMatch(/\d+ pass/);
    expect(plain.text).not.toMatch(/coverage-gate|^ok\s+\d/m);

    const cov = await make("test-coverage");
    expect(cov.code).toBe(0);
    const pure = (await Bun.file(join(copy, "src/test/pure-files.ts")).text()).match(/"[^"]+\.tsx?"/g) ?? [];
    expect(pure.length).toBeGreaterThan(0);
    for (const f of pure) expect(cov.text).toContain(f.replaceAll('"', ""));
    expect(cov.text).toMatch(/ok\s+100\.0%\s+src\/toolchain\.ts/);

    rmSync(join(copy, "src/toolchain.test.ts"));
    const cov2 = await make("test-coverage");
    expect(cov2.text).toMatch(/0(\.0)?%\s+src\/toolchain\.ts/);
    expect(cov2.code).not.toBe(0);
    expect(cov2.text).toContain("src/toolchain.test.ts");

    const plain2 = await make("test");
    expect(plain2.code).toBe(0);
    expect(existsSync(join(copy, "src/toolchain.test.ts"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900000);
