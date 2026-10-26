import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A small werk-shaped project: the real Makefile, scripts and gate, with its own list of pure files. */
async function build(pure: string[], files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "heldout-cov-"));
  made.push(dir);
  for (const name of ["Makefile", ".bun-version", "bun.lock"]) cpSync(join(ROOT, name), join(dir, name));
  const real = JSON.parse(await Bun.file(join(ROOT, "package.json")).text());
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "mini",
      type: "module",
      scripts: { test: real.scripts.test, "test:coverage": real.scripts["test:coverage"] },
    }),
  );
  mkdirSync(join(dir, "src", "test"), { recursive: true });
  for (const f of ["coverage-gate.ts", "coverage-report.ts"]) cpSync(join(ROOT, "src", "test", f), join(dir, "src", "test", f));
  writeFileSync(join(dir, "src", "test", "pure-files.ts"), `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".install-stamp"), "");
  const run = async (target: string) => {
    const p = Bun.spawn(["make", target], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { stdout, stderr, code, all: stdout + stderr };
  };
  return { dir, run };
}

const A = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
const A_TEST = `import { expect, test } from "bun:test";\nimport { add } from "./a.ts";\ntest("add", () => expect(add(1, 2)).toBe(3));\n`;
const OTHER = `import { expect, test } from "bun:test";\ntest("other", () => expect(1).toBe(1));\n`;

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const p = await build(["src/pure/a.ts"], { "src/pure/a.ts": A, "src/pure/a.test.ts": A_TEST });
  const r = await p.run("test-coverage");
  const gate = r.stdout.split("\n").filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/a.ts"));
  expect(gate).toHaveLength(1);
  expect(gate[0]).toMatch(/100\.0%/);
  expect(r.code).toBe(0);
});

test("02.2 a pure file whose own test is deleted fails even when another test runs its lines", async () => {
  const p = await build(["src/pure/a.ts"], {
    "src/pure/a.ts": A,
    "src/pure/a.test.ts": A_TEST,
    "src/other/b.test.ts": `import { expect, test } from "bun:test";\nimport { add } from "../pure/a.ts";\ntest("b", () => expect(add(2, 2)).toBe(4));\n`,
  });
  const first = await p.run("test-coverage");
  expect(first.code).toBe(0);
  rmSync(join(p.dir, "src/pure/a.test.ts"));
  const r = await p.run("test-coverage");
  const gate = r.stdout.split("\n").filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/a.ts"));
  expect(gate).toHaveLength(1);
  expect(gate[0]).toMatch(/FAIL\s+0\.0%/);
  expect(gate[0]).toContain("src/pure/a.test.ts");
  expect(r.code).not.toBe(0);
});

test("02.3 a pure file under 90% fails the gate", async () => {
  const src = Array.from({ length: 5 }, (_, i) => `export function f${i}(): number {\n  return ${i};\n}\n`).join("");
  const test_ = `import { expect, test } from "bun:test";\nimport { f0 } from "./a.ts";\ntest("f0", () => expect(f0()).toBe(0));\n`;
  const p = await build(["src/pure/a.ts"], { "src/pure/a.ts": src, "src/pure/a.test.ts": test_ });
  const r = await p.run("test-coverage");
  const gate = r.stdout.split("\n").filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/a.ts"));
  expect(gate).toHaveLength(1);
  expect(gate[0]).toMatch(/^FAIL\s+\d+\.\d%/);
  expect(r.code).not.toBe(0);
});

test("02.4 a pure file of type declarations only passes", async () => {
  const p = await build(["src/pure/types.ts"], {
    "src/pure/types.ts": `export type Shape = { name: string };\nexport interface Named {\n  name: string;\n}\n`,
    "src/other.test.ts": OTHER,
  });
  const r = await p.run("test-coverage");
  const gate = r.stdout.split("\n").filter((l) => l.includes("src/pure/types.ts") && /^(ok|FAIL)\s/.test(l));
  expect(gate).toHaveLength(1);
  expect(gate[0]).toMatch(/^ok\s/);
  expect(r.code).toBe(0);
});

test("02.5 a plain test run never runs the gate", async () => {
  const p = await build(["src/pure/a.ts"], { "src/pure/a.ts": A, "src/other.test.ts": OTHER });
  const r = await p.run("test");
  expect(r.code).toBe(0);
  expect(r.all).toMatch(/1 pass/);
  expect(r.all).not.toMatch(/missing test file/);
  expect(r.all).not.toMatch(/^(ok|FAIL)\s.*src\/pure\/a\.ts/m);
  expect(r.all).not.toMatch(/\d+\.\d%\s+src\/pure/);
});
