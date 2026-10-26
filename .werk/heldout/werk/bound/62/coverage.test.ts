import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
let dir: string;

/** A small werk-shaped project: the real Makefile, scripts, gate and test env, with its own list of pure files. */
function makeProject(pure: string[]) {
  dir = mkdtempSync(join(tmpdir(), "werk-ho-cov-"));
  for (const f of ["Makefile", "package.json", "bunfig.toml", ".bun-version", "bun.lock"]) cpSync(join(ROOT, f), join(dir, f));
  mkdirSync(join(dir, "src", "test"), { recursive: true });
  for (const f of ["coverage-gate.ts", "coverage-report.ts"]) cpSync(join(ROOT, "src", "test", f), join(dir, "src", "test", f));
  cpSync(join(ROOT, "src", "test-env"), join(dir, "src", "test-env"), { recursive: true });
  cpSync(join(ROOT, "src", "fake-agent"), join(dir, "src", "fake-agent"), { recursive: true });
  cpSync(join(ROOT, "fake"), join(dir, "fake"), { recursive: true });
  writeFileSync(join(dir, "src", "test", "pure-files.ts"), `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`);
  const mods = join(dir, "node_modules");
  mkdirSync(mods);
  for (const n of readdirSync(join(ROOT, "node_modules"))) if (n !== ".vite" && n !== ".install-stamp") symlinkSync(join(ROOT, "node_modules", n), join(mods, n));
  writeFileSync(join(mods, ".install-stamp"), "");
  // a test that always runs, so plain `make test` has unit tests to run
  writeFileSync(join(dir, "src", "plain.test.ts"), `import {test,expect} from "bun:test"; test("plain unit test ran", () => expect(1).toBe(1));\n`);
}
const put = (path: string, text: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};
async function make(target: string) {
  const p = Bun.spawn(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code, all: stdout + stderr };
}
beforeEach(() => {});
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

const PURE = `export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n`;
const OWN = `import {test,expect} from "bun:test"; import {add,sub} from "./calc.ts"; test("calc", () => { expect(add(1,2)).toBe(3); expect(sub(3,1)).toBe(2); });\n`;

test("02.1 pure file covered by own test passes", async () => {
  makeProject(["src/calc.ts"]);
  put("src/calc.ts", PURE);
  put("src/calc.test.ts", OWN);
  const r = await make("test-coverage");
  expect(r.all).toMatch(/^ok\s+100\.0%\s+src\/calc\.ts/m);
  expect(r.all.split("\n").filter((l) => /src\/calc\.ts\s*$/.test(l) && /^(ok|FAIL)/.test(l)).length).toBe(1);
  expect(r.code).toBe(0);
});

test("02.2 deleting own test fails even when another test runs the lines", async () => {
  makeProject(["src/calc.ts"]);
  put("src/calc.ts", PURE);
  put("src/calc.test.ts", OWN);
  put("src/other.test.ts", `import {test,expect} from "bun:test"; import {add,sub} from "./calc.ts"; test("other", () => { expect(add(1,2)).toBe(3); expect(sub(3,1)).toBe(2); });\n`);
  const base = await make("test-coverage");
  expect(base.code).toBe(0);
  rmSync(join(dir, "src", "calc.test.ts"));
  const r = await make("test-coverage");
  expect(r.all).toMatch(/FAIL\s+0\.0%\s+src\/calc\.ts/);
  expect(r.all).toContain("src/calc.test.ts");
  expect(r.code).not.toBe(0);
});

test("02.3 pure file under 90% fails", async () => {
  makeProject(["src/calc.ts"]);
  put("src/calc.ts", PURE);
  put("src/calc.test.ts", `import {test,expect} from "bun:test"; import {add} from "./calc.ts"; test("calc", () => { expect(add(1,2)).toBe(3); });\n`);
  const r = await make("test-coverage");
  expect(r.all).toMatch(/FAIL\s+\d+(\.\d)?%\s+src\/calc\.ts/);
  expect(r.code).not.toBe(0);
});

test("02.4 types-only pure file passes", async () => {
  makeProject(["src/types.ts"]);
  put("src/types.ts", `export type A = { a: number };\nexport interface B { b: string }\n`);
  const r = await make("test-coverage");
  expect(r.all).toMatch(/^ok\s+100\.0%\s+src\/types\.ts/m);
  expect(r.code).toBe(0);
});

test("02.5 plain make test never runs the gate", async () => {
  makeProject(["src/calc.ts"]);
  put("src/calc.ts", PURE);
  const r = await make("test");
  expect(r.all).toMatch(/\d+ pass/);
  expect(r.all).not.toMatch(/src\/calc\.ts/);
  expect(r.all).not.toMatch(/missing test file/);
  expect(r.code).toBe(0);
});

test("61.4 gate fails below 90 and passes again after restore (mini project)", async () => {
  makeProject(["src/calc.ts"]);
  put("src/calc.ts", PURE);
  put("src/calc.test.ts", OWN);
  expect((await make("test-coverage")).code).toBe(0);
  put("src/calc.test.ts", `import {test,expect} from "bun:test"; import {add} from "./calc.ts"; test("calc", () => { expect(add(1,2)).toBe(3); });\n`);
  expect((await make("test")).code).toBe(0);
  const bad = await make("test-coverage");
  expect(bad.code).not.toBe(0);
  expect(bad.all).toMatch(/src\/calc\.ts/);
  expect(bad.all).toMatch(/\d+(\.\d)?%/);
  put("src/calc.test.ts", OWN);
  expect((await make("test-coverage")).code).toBe(0);
});
