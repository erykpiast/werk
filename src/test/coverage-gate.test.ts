import { expect, test } from "bun:test";
import { join } from "node:path";

const gate = join(import.meta.dir, "coverage-gate.ts");

async function run(...files: string[]) {
  const proc = Bun.spawn([process.execPath, gate, ...files], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
}

test("a listed file of type declarations with no own test passes", async () => {
  const r = await run("src/test/fixtures/types-only.ts");
  expect(r.code).toBe(0);
  expect(r.out).toContain("src/test/fixtures/types-only.ts");
});

test("a listed file with code and no own test fails and names the test", async () => {
  const r = await run("src/test/fixtures/code-no-test.ts");
  expect(r.code).toBe(1);
  expect(r.out).toContain("src/test/fixtures/code-no-test.test.ts");
  expect(r.out).toContain("0.0%");
});
