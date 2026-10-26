import { afterAll, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv } from "../src/test-env/env.ts";
import { PURE_FILES } from "../src/test/pure-files.ts";
import { ownTestPath } from "../src/test/coverage-report.ts";
import { repoCopy } from "./repo-copy.ts";

let copy = "";
afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

async function make(target: string) {
  const p = Bun.spawn(["make", target], {
    cwd: copy,
    env: cleanEnv(process.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out: out + err, code };
}

test("01.1 make test, make test-coverage, and a missing own test file", async () => {
  copy = repoCopy();
  const plain = await make("test");
  expect(plain.code).toBe(0);
  expect(plain.out).not.toMatch(/coverage/i);
  expect(plain.out).not.toMatch(/% Lines/);

  const cov = await make("test-coverage");
  expect(cov.code).toBe(0);
  for (const file of PURE_FILES) {
    const line = cov.out.split("\n").find((l) => l.includes(file) && /\d+(\.\d+)?%/.test(l) && !/\|/.test(l));
    expect(line, `no percentage line for ${file}`).toBeDefined();
  }

  const victim = PURE_FILES.find((f) => f.startsWith("src/map/link-rules"))!;
  rmSync(join(copy, ownTestPath(victim)));
  expect(existsSync(join(copy, ownTestPath(victim)))).toBe(false);
  const again = await make("test-coverage");
  const gone = again.out.split("\n").find((l) => l.includes(victim) && !/\|/.test(l));
  expect(gone).toMatch(/0(\.0+)?%/);
  expect(again.code).not.toBe(0);
  expect(again.out).toContain(ownTestPath(victim));
  const after = await make("test");
  expect(after.out).not.toMatch(/coverage/i);
  expect(after.code).toBe(0);
}, 900000);
