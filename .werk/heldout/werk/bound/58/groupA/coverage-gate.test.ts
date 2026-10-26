import { afterEach, expect, test } from "bun:test";
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
import { ROOT } from "./helpers.ts";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FULL = `export function add(a: number, b: number): number {
  return a + b;
}
export function sub(a: number, b: number): number {
  return a - b;
}
`;
const FULL_TEST = `import { expect, test } from "bun:test";
import { add, sub } from "./a.ts";
test("a", () => {
  expect(add(1, 2)).toBe(3);
  expect(sub(3, 2)).toBe(1);
});
`;
const OTHER_TEST = `import { expect, test } from "bun:test";
import { add, sub } from "../pure/a.ts";
test("other runs every line of a", () => {
  expect(add(1, 2)).toBe(3);
  expect(sub(3, 2)).toBe(1);
});
`;
const PARTIAL = `export function one(): number {
  return 1;
}
export function two(): number {
  const x = 1;
  const y = 2;
  const z = 3;
  return x + y + z;
}
export function three(): number {
  const q = 4;
  const r = 5;
  return q * r;
}
`;
const PARTIAL_TEST = `import { expect, test } from "bun:test";
import { one } from "./a.ts";
test("only one", () => {
  expect(one()).toBe(1);
});
`;
const TYPES = `export type Shape = { name: string };
export interface Named {
  name: string;
}
`;
const TRIVIAL = `import { expect, test } from "bun:test";
test("trivial", () => {
  expect(1).toBe(1);
});
`;

/** A small project that has werk's own gate, Makefile and test setup, and its own list of pure files. */
function project(files: Record<string, string>, pure: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-ho-gate-"));
  made.push(dir);
  for (const f of ["Makefile", "package.json", "bunfig.toml", ".bun-version", "bun.lock", "tsconfig.json"]) {
    cpSync(join(ROOT, f), join(dir, f));
  }
  mkdirSync(join(dir, "src", "test"), { recursive: true });
  for (const f of ["coverage-gate.ts", "coverage-report.ts"]) {
    cpSync(join(ROOT, "src", "test", f), join(dir, "src", "test", f));
  }
  cpSync(join(ROOT, "src", "test-env"), join(dir, "src", "test-env"), { recursive: true });
  for (const f of readdirSync(join(dir, "src", "test-env"))) {
    if (f.includes(".test.")) rmSync(join(dir, "src", "test-env", f));
  }
  writeFileSync(
    join(dir, "src", "test", "pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`,
  );
  // The dependencies are the locked ones of the checkout, linked in, with the install stamp set.
  mkdirSync(join(dir, "node_modules"));
  for (const e of readdirSync(join(ROOT, "node_modules"))) {
    symlinkSync(join(ROOT, "node_modules", e), join(dir, "node_modules", e));
  }
  writeFileSync(join(dir, "node_modules", ".install-stamp"), "");
  Bun.spawnSync(["touch", join(dir, "node_modules", ".install-stamp")]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

async function make(dir: string, target: string) {
  const env = { ...process.env } as Record<string, string>;
  const proc = Bun.spawn(["make", target], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, out: stdout + stderr, code };
}

const A = "src/pure/a.ts";

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const dir = project({ [A]: FULL, "src/pure/a.test.ts": FULL_TEST }, [A]);
  const r = await make(dir, "test-coverage");
  console.log(r.out.split("\n").filter((l) => l.includes("a.ts")).join("\n"));
  const lines = r.out.split("\n").filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes(A));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("100.0%");
  expect(r.code).toBe(0);
}, 120000);

test("02.2 deleting the own test fails the gate even when another test runs the lines", async () => {
  const dir = project({ [A]: FULL, "src/pure/a.test.ts": FULL_TEST, "src/other/b.test.ts": OTHER_TEST }, [A]);
  const first = await make(dir, "test-coverage");
  expect(first.code).toBe(0);
  rmSync(join(dir, "src/pure/a.test.ts"));
  const r = await make(dir, "test-coverage");
  const line = r.out.split("\n").find((l) => /^(ok|FAIL)\s/.test(l) && l.includes(A)) ?? "";
  console.log("02.2 line:", line);
  expect(line).toContain("0.0%");
  expect(line).toContain("src/pure/a.test.ts");
  expect(r.code).not.toBe(0);
}, 120000);

test("02.3 a pure file under 90% fails the gate", async () => {
  const dir = project({ [A]: PARTIAL, "src/pure/a.test.ts": PARTIAL_TEST }, [A]);
  const r = await make(dir, "test-coverage");
  const line = r.out.split("\n").find((l) => /^(ok|FAIL)\s/.test(l) && l.includes(A)) ?? "";
  console.log("02.3 line:", line);
  expect(line).toMatch(/\d+\.\d%/);
  expect(line).not.toContain("100.0%");
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a pure file of type declarations only passes", async () => {
  const dir = project({ [A]: TYPES, "src/other/t.test.ts": TRIVIAL }, [A]);
  const r = await make(dir, "test-coverage");
  const line = r.out.split("\n").find((l) => /^(ok|FAIL)\s/.test(l) && l.includes(A)) ?? "";
  console.log("02.4 line:", line);
  expect(line.startsWith("ok")).toBe(true);
  expect(r.code).toBe(0);
}, 120000);

test("02.5 the plain test run never runs the gate", async () => {
  const dir = project({ [A]: FULL, "src/other/t.test.ts": TRIVIAL }, [A]);
  const r = await make(dir, "test");
  console.log("02.5 out:", r.out.slice(-400));
  expect(r.out).toMatch(/1 pass/);
  expect(r.out).not.toContain("a.ts");
  expect(r.out).not.toMatch(/missing test file/);
  expect(r.out).not.toMatch(/\d+\.\d%/);
  expect(r.code).toBe(0);
}, 120000);
