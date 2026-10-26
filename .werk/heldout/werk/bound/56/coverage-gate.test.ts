import { afterAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const GATE = join(ROOT, "src", "test", "coverage-gate.ts");
const G = ".werk-heldout/gate";

async function gate(...files: string[]) {
  const proc = Bun.spawn([process.execPath, GATE, ...files], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { code: await proc.exited, out, err };
}

test("02.1 a pure file with its own test at 100% passes", async () => {
  const r = await gate(`${G}/full.ts`);
  const lines = r.out.trim().split("\n").filter((l) => l.includes("full.ts"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("100");
  expect(r.code).toBe(0);
}, 60000);

test("02.2 deleting the own test fails the file even though another test runs its lines", async () => {
  copyFileSync(join(ROOT, G, "full.ts"), join(ROOT, G, "gone.ts"));
  writeFileSync(
    join(ROOT, G, "gone.test.ts"),
    readFileSync(join(ROOT, G, "full.test.ts"), "utf8").replaceAll("./full.ts", "./gone.ts"),
  );
  copyFileSync(join(ROOT, G, "other.test.ts"), join(ROOT, G, "gone-other.test.ts"));
  writeFileSync(
    join(ROOT, G, "gone-other.test.ts"),
    readFileSync(join(ROOT, G, "other.test.ts"), "utf8").replaceAll("./full.ts", "./gone.ts"),
  );
  const before = await gate(`${G}/gone.ts`);
  expect(before.out).toContain("100");
  expect(before.code).toBe(0);
  rmSync(join(ROOT, G, "gone.test.ts"));
  const r = await gate(`${G}/gone.ts`);
  expect(r.out).toContain("0.0%");
  expect(r.out).toContain(`${G}/gone.test.ts`);
  expect(r.code).toBe(1);
  rmSync(join(ROOT, G, "gone.ts"));
  rmSync(join(ROOT, G, "gone-other.test.ts"));
}, 60000);

test("02.3 a pure file under 90% fails the gate", async () => {
  const r = await gate(`${G}/partial.ts`);
  const line = r.out.split("\n").find((l) => l.includes("partial.ts")) ?? "";
  expect(line).toMatch(/\d+(\.\d+)?%/);
  expect(Number.parseFloat(line.match(/(\d+(\.\d+)?)%/)?.[1] ?? "100")).toBeLessThan(90);
  expect(r.code).toBe(1);
}, 60000);

test("02.4 a file of type declarations only passes", async () => {
  const r = await gate(`${G}/types.ts`);
  expect(r.out).toContain("types.ts");
  expect(r.out).toMatch(/no executable lines|100/);
  expect(r.code).toBe(0);
}, 60000);

test("02.5 a plain test run never runs the gate", async () => {
  const proc = Bun.spawn(
    [process.execPath, "test", "--parallel=4", "--timeout=15000", "./src/test/coverage-report.test.ts"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  expect(await proc.exited).toBe(0);
  expect(out).not.toMatch(/% Funcs|% Lines/);
  expect(out).not.toMatch(/no own test|missing test/i);
  expect(existsSync(join(ROOT, "lcov.info"))).toBe(false);
}, 60000);

afterAll(() => {
  rmSync(join(ROOT, G, "gone.ts"), { force: true });
  rmSync(join(ROOT, G, "gone-other.test.ts"), { force: true });
  rmSync(join(ROOT, G, "gone.test.ts"), { force: true });
});

test("02.1 on the checkout's real list: the gate prints a 100% line for a listed file and the run exits with success", async () => {
  const r = await gate();
  const line = r.out.split("\n").find((l) => l.includes("src/map/fold.ts")) ?? "";
  expect(line).toContain("100");
  expect(r.out.split("\n").filter((l) => l.includes("src/map/fold.ts"))).toHaveLength(1);
  expect(r.out).not.toContain("FAIL");
  expect(r.code).toBe(0);
}, 300000);
