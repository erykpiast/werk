/** 01.1 runs in a copy of the checkout, because the step deletes a tracked test file. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PURE_FILES } from "../../src/test/pure-files.ts";

const ROOT = join(import.meta.dir, "..", "..");
let copy = "";

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  // git archive keeps the symlinks of the checkout.
  const tar = Bun.spawnSync(["sh", "-c", `git archive HEAD | tar -x -C "${copy}"`], { cwd: ROOT });
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
  Bun.spawnSync(["cp", "-cR", join(ROOT, "node_modules"), join(copy, "node_modules")]);
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

const make = async (target: string) => {
  const env = { ...process.env } as Record<string, string>;
  delete env.CI;
  const p = Bun.spawn(["make", target], { cwd: copy, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, out: stdout + stderr, code };
};

test("01.1 make test, make test-coverage, and a deleted own test", async () => {
  const target = "src/cli/args.ts";
  expect(PURE_FILES).toContain(target);
  const t = await make("test");
  const c = await make("test-coverage");
  rmSync(join(copy, "src/cli/args.test.ts"));
  expect(existsSync(join(copy, "src/cli/args.test.ts"))).toBe(false);
  const c2 = await make("test-coverage");
  const t2 = await make("test");
  const tail = (r: { out: string }) => r.out.slice(-1500);
  const report = { t: t.code, c: c.code, c2: c2.code, t2: t2.code };
  await Bun.write("/tmp/gate-report.json", JSON.stringify({ report, t: tail(t), c: tail(c), c2: tail(c2), t2: tail(t2) }, null, 1));

  // 1. make test passes and reports no coverage.
  expect(t.code, `make test: ${tail(t)}`).toBe(0);
  expect(t.out.toLowerCase()).not.toContain("coverage");
  // 2. make test-coverage prints one line per pure file with its percentage, and passes.
  const lines = c.stdout.split("\n");
  for (const file of PURE_FILES) {
    const line = lines.find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l));
    expect(line, `no percentage line for ${file}`).toBeDefined();
  }
  expect(c.code, `make test-coverage: ${tail(c)}`).toBe(0);
  // 3. Without the own test file, the file shows 0% and the gate fails and names the test file.
  const line = c2.stdout.split("\n").find((l) => l.includes(target) && /%/.test(l)) ?? "";
  expect(line).toContain("0%");
  expect(c2.code).not.toBe(0);
  expect(c2.out).toContain("src/cli/args.test.ts");
  // 4. make test still passes without a coverage failure.
  expect(t2.out.toLowerCase()).not.toContain("coverage");
  expect(t2.code, `make test again: ${tail(t2)}`).toBe(0);
}, 3000000);
