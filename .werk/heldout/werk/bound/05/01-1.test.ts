import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = join(import.meta.dir, "..");
const tracked = (await Bun.$`git ls-files`.cwd(src).text()).split("\n").filter(Boolean);
const work = mkdtempSync(join(tmpdir(), "werk-ho-01-"));
for (const f of tracked) {
  if (f.startsWith(".werk-heldout/")) continue;
  cpSync(join(src, f), join(work, f), { recursive: true });
}

async function make(target: string) {
  const p = Bun.spawn(["make", target], { cwd: work, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "true" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out: out + err, code };
}

test("01.1 make test, make test-coverage, deleted own test", async () => {
  const PURE = (await Bun.file(join(work, "src/test/pure-files.ts")).text()).match(/"src\/[^"]+"/g)!.map((s) => s.slice(1, -1));
  expect(PURE.length).toBeGreaterThan(0);

  const t = await make("test");
  console.log(t.out.slice(-600));
  expect(t.code).toBe(0);
  expect(t.out).not.toMatch(/% Funcs|% Lines/);

  const c = await make("test-coverage");
  console.log(c.out.slice(-1200));
  expect(c.code).toBe(0);
  for (const f of PURE) expect(c.out).toMatch(new RegExp(`\\d+\\.\\d%\\s+${f.replace(/[./]/g, "\\$&")}`));

  const target = PURE[PURE.length - 1]!;
  const own = target.replace(/\.ts$/, ".test.ts");
  expect(existsSync(join(work, own))).toBe(true);
  rmSync(join(work, own));
  const c2 = await make("test-coverage");
  console.log(c2.out.slice(-1200));
  expect(c2.code).not.toBe(0);
  expect(c2.out).toMatch(new RegExp(`0\\.0%\\s+${target.replace(/[./]/g, "\\$&")}`));
  expect(c2.out).toContain(own);

  const t2 = await make("test");
  expect(t2.code).toBe(0);
  expect(t2.out).not.toMatch(/FAIL\s+0\.0%/);
}, 600000);
