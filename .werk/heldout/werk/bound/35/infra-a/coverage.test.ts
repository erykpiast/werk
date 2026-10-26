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
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
let dir: string;

/** A reduced copy of werk: its Makefile, test config and gate, and the pure files of the test. */
function makeProject(pure: string[]) {
  dir = mkdtempSync(join(tmpdir(), "heldout-cov-"));
  for (const f of ["Makefile", "package.json", "bunfig.toml", ".bun-version", "bun.lock"])
    cpSync(join(CHECKOUT, f), join(dir, f));
  for (const f of ["coverage-gate.ts", "coverage-report.ts"])
    cpSync(join(CHECKOUT, "src/test", f), join(dir, "src/test", f));
  cpSync(join(CHECKOUT, "src/test-env"), join(dir, "src/test-env"), {
    recursive: true,
    filter: (s) => !s.endsWith(".test.ts") && !s.endsWith(".test.tsx"),
  });
  cpSync(join(CHECKOUT, "fake"), join(dir, "fake"), { recursive: true });
  cpSync(join(CHECKOUT, "src/fake-agent"), join(dir, "src/fake-agent"), {
    recursive: true,
    filter: (s) => !s.endsWith(".test.ts"),
  });
  mkdirSync(join(dir, "node_modules"));
  for (const e of readdirSync(join(CHECKOUT, "node_modules")))
    symlinkSync(join(CHECKOUT, "node_modules", e), join(dir, "node_modules", e));
  writeFileSync(join(dir, "node_modules/.install-stamp"), "");
  writeFileSync(
    join(dir, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`,
  );
  mkdirSync(join(dir, "src/pure"), { recursive: true });
}

const put = (path: string, text: string) => writeFileSync(join(dir, path), text);

async function make(target: string) {
  const p = Bun.spawn(["make", target], {
    cwd: dir,
    env: { ...process.env, CI: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code, all: out + err };
}

const FULL = `export function add(a: number, b: number): number {
  return a + b;
}
export function neg(a: number): number {
  return -a;
}
`;
const FULL_TEST = `import { expect, test } from "bun:test";
import { add, neg } from "./full.ts";
test("full", () => { expect(add(1, 2)).toBe(3); expect(neg(1)).toBe(-1); });
`;

beforeEach(() => {});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("02.1 a pure file covered by its own test passes the gate", async () => {
  makeProject(["src/pure/full.ts"]);
  put("src/pure/full.ts", FULL);
  put("src/pure/full.test.ts", FULL_TEST);
  const r = await make("test-coverage");
  const lines = r.all.split("\n").filter((l) => l.includes("src/pure/full.ts") && l.includes("%") && /^(ok|FAIL)/.test(l.trim()));
  expect(lines.length).toBe(1);
  expect(lines[0]).toContain("100.0%");
  expect(r.code).toBe(0);
});

test("02.2 a pure file whose own test is deleted fails even when another test runs it", async () => {
  makeProject(["src/pure/full.ts"]);
  put("src/pure/full.ts", FULL);
  put("src/pure/full.test.ts", FULL_TEST);
  put("src/pure/other.test.ts", `import { expect, test } from "bun:test";
import { add, neg } from "./full.ts";
test("other", () => { expect(add(2, 2)).toBe(4); expect(neg(2)).toBe(-2); });
`);
  const before = await make("test-coverage");
  expect(before.code).toBe(0);
  rmSync(join(dir, "src/pure/full.test.ts"));
  const r = await make("test-coverage");
  const line = r.all.split("\n").find((l) => /^FAIL/.test(l.trim()) && l.includes("src/pure/full.ts"));
  expect(line).toBeDefined();
  expect(line).toContain("0.0%");
  expect(r.all).toContain("src/pure/full.test.ts");
  expect(r.code).not.toBe(0);
});

test("02.3 a pure file under 90% fails the gate", async () => {
  makeProject(["src/pure/part.ts"]);
  put("src/pure/part.ts", `export function a(): number {
  return 1;
}
export function b(): number {
  return 2;
}
export function c(): number {
  return 3;
}
export function d(): number {
  return 4;
}
`);
  put("src/pure/part.test.ts", `import { expect, test } from "bun:test";
import { a } from "./part.ts";
test("part", () => { expect(a()).toBe(1); });
`);
  const r = await make("test-coverage");
  const line = r.all.split("\n").find((l) => l.includes("src/pure/part.ts") && /^(ok|FAIL)/.test(l.trim()));
  expect(line).toMatch(/\d+\.\d%/);
  expect(line).not.toContain("100.0%");
  expect(r.code).not.toBe(0);
});

test("02.4 a pure file of type declarations only passes", async () => {
  makeProject(["src/pure/types.ts"]);
  put("src/pure/types.ts", `export type Shape = { name: string };\nexport interface Named { name: string }\n`);
  put("src/pure/keep.test.ts", `import { expect, test } from "bun:test";\ntest("keep", () => expect(1).toBe(1));\n`);
  const r = await make("test-coverage");
  const line = r.all.split("\n").find((l) => l.includes("src/pure/types.ts") && /^(ok|FAIL)/.test(l.trim()));
  expect(line).toBeDefined();
  expect(line?.trim().startsWith("ok")).toBe(true);
  expect(r.code).toBe(0);
});

test("02.5 a plain test run never runs the gate", async () => {
  makeProject(["src/pure/full.ts"]);
  put("src/pure/full.ts", FULL);
  put("src/pure/keep.test.ts", `import { expect, test } from "bun:test";\ntest("keep", () => expect(1).toBe(1));\n`);
  const r = await make("test");
  expect(r.all).toMatch(/1 pass/);
  expect(r.code).toBe(0);
  expect(r.all).not.toContain("src/pure/full.ts");
  expect(r.all).not.toContain("full.test.ts");
  expect(r.all).not.toMatch(/missing test file/);
});
