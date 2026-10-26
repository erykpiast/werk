import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./h.ts";

let dir: string;
const w = (rel: string, text: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

const FULL = `export function add(a: number, b: number) {\n  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n`;
const FULL_TEST = `import { expect, test } from "bun:test";\nimport { add, sub } from "./full.ts";\ntest("x", () => { expect(add(1, 2)).toBe(3); expect(sub(3, 1)).toBe(2); });\n`;
const PARTIAL = `export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\nexport function c() {\n  return 3;\n}\nexport function d() {\n  return 4;\n}\n`;
const PARTIAL_TEST = `import { expect, test } from "bun:test";\nimport { a } from "./partial.ts";\ntest("x", () => { expect(a()).toBe(1); });\n`;
const OTHER_TEST = `import { expect, test } from "bun:test";\nimport { add, sub } from "./pure/full.ts";\ntest("other", () => { expect(add(1, 1)).toBe(2); expect(sub(2, 1)).toBe(1); });\n`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-held-gate-"));
  for (const f of [
    "Makefile",
    "package.json",
    "bun.lock",
    ".bun-version",
    "bunfig.toml",
    "tsconfig.json",
  ])
    cpSync(join(ROOT, f), join(dir, f));
  for (const f of ["preload.ts", "env.ts", "dom.ts"])
    cpSync(join(ROOT, "src", "test-env", f), join(dir, "src", "test-env", f));
  for (const f of ["coverage-gate.ts", "coverage-report.ts"])
    cpSync(join(ROOT, "src", "test", f), join(dir, "src", "test", f));
  mkdirSync(join(dir, "node_modules"));
  for (const n of readdirSync(join(ROOT, "node_modules")))
    symlinkSync(join(ROOT, "node_modules", n), join(dir, "node_modules", n));
  mkdirSync(join(dir, "client"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".install-stamp"), "");
  // the e2e-free minimal project: dom preload needs nothing else
  w(
    "src/test/pure-files.ts",
    `export const PURE_FILES: readonly string[] = ["src/pure/full.ts"];\n`,
  );
  w("src/pure/full.ts", FULL);
  w("src/pure/full.test.ts", FULL_TEST);
  w(
    "src/keep.test.ts",
    `import { expect, test } from "bun:test";\ntest("keep", () => expect(1).toBe(1));\n`,
  );
});
afterEach(() => {
  if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true });
});

const make = async (target: string) => {
  const proc = Bun.spawn(["make", target], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [o, e, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: o, err: e, all: `${o}\n${e}` };
};
const setList = (...files: string[]) =>
  w(
    "src/test/pure-files.ts",
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(files)};\n`,
  );

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const r = await make("test-coverage");
  const gateLines = r.all
    .split("\n")
    .filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/full.ts"));
  expect(gateLines.length).toBe(1);
  expect(gateLines[0]).toMatch(/100\.0%/);
  expect(r.code).toBe(0);
});

test("02.2 deleting the own test fails even when another test runs the lines", async () => {
  w("src/other.test.ts", OTHER_TEST);
  rmSync(join(dir, "src/pure/full.test.ts"));
  const r = await make("test-coverage");
  const line =
    r.all
      .split("\n")
      .find((l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/full.ts")) ??
    "";
  expect(line).toMatch(/0\.0%/);
  expect(line).toContain("src/pure/full.test.ts");
  expect(r.code).not.toBe(0);
});

test("02.3 a pure file under 90% fails the gate", async () => {
  setList("src/pure/partial.ts");
  w("src/pure/partial.ts", PARTIAL);
  w("src/pure/partial.test.ts", PARTIAL_TEST);
  const r = await make("test-coverage");
  const line =
    r.all
      .split("\n")
      .find(
        (l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/partial.ts"),
      ) ?? "";
  expect(line).toMatch(/FAIL\s+\d+\.\d%/);
  expect(r.code).not.toBe(0);
});

test("02.4 a pure file of type declarations only passes", async () => {
  setList("src/pure/types.ts");
  w(
    "src/pure/types.ts",
    `export type Shape = { name: string };\nexport interface Named {\n  name: string;\n}\n`,
  );
  const r = await make("test-coverage");
  const line =
    r.all
      .split("\n")
      .find((l) => /^(ok|FAIL)\s/.test(l) && l.includes("src/pure/types.ts")) ??
    "";
  expect(line).toMatch(/^ok/);
  expect(r.code).toBe(0);
});

test("02.5 plain make test never runs the gate", async () => {
  setList("src/pure/nolist.ts");
  w("src/pure/nolist.ts", `export const x = 1;\n`);
  const r = await make("test");
  expect(r.code).toBe(0);
  expect(r.all).toMatch(/pass/);
  expect(r.all).not.toMatch(/^(ok|FAIL)\s+\d/m);
  expect(r.all).not.toContain("missing test file");
});
