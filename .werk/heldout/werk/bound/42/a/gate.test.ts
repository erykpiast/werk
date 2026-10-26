import { afterAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyApp } from "../../src/test-env/app-copy.ts";

const ROOT = join(import.meta.dir, "..", "..");
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** A copy of the app where the list of pure files and the tests are only the given ones. */
function project(pure: string[], files: Record<string, string>) {
  const root = join(
    tmpdir(),
    `werk-heldout-a-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  made.push(root);
  copyApp(root);
  for (const f of walk(root)) {
    if (/\.test\.tsx?$/.test(f)) rmSync(f);
  }
  for (const n of ["Makefile", ".bun-version", "bun.lock"])
    cpSync(join(ROOT, n), join(root, n));
  writeFileSync(
    join(root, "src/test/pure-files.ts"),
    `export const PURE_FILES: readonly string[] = ${JSON.stringify(pure)};\n`,
  );
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(join(root, "node_modules/.install-stamp"), "");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  const make = async (target: string) => {
    const p = Bun.spawn(["make", target], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out: out + err, code };
  };
  return { root, make };
}

const PURE = `export function add(a: number, b: number): number {
  return a + b;
}
export function neg(a: number): number {
  return -a;
}
export function twice(a: number): number {
  return a * 2;
}
`;
const OWN_FULL = `import { expect, test } from "bun:test";
import { add, neg, twice } from "./calc.ts";
test("all", () => {
  expect(add(1, 2)).toBe(3);
  expect(neg(1)).toBe(-1);
  expect(twice(2)).toBe(4);
});
`;
const OWN_PART = `import { expect, test } from "bun:test";
import { add } from "./calc.ts";
test("part", () => { expect(add(1, 2)).toBe(3); });
`;
const OTHER = `import { expect, test } from "bun:test";
import { add, neg, twice } from "./calc.ts";
test("other", () => {
  expect(add(1, 2)).toBe(3);
  expect(neg(1)).toBe(-1);
  expect(twice(2)).toBe(4);
});
`;
const F = "src/demo/calc.ts";

describe("02 coverage gate", () => {
  test("02.1 pure file covered by own test passes", async () => {
    const p = project([F], {
      [F]: PURE,
      "src/demo/calc.test.ts": OWN_FULL,
    });
    const r = await p.make("test-coverage");
    const lines = r.out.split("\n").filter((l) => l.includes(F));
    const gateLines = lines.filter((l) => /^(ok|FAIL)\s/.test(l));
    expect(gateLines.length).toBe(1);
    expect(gateLines[0]).toContain("100.0%");
    expect(r.code).toBe(0);
  }, 120000);

  test("02.2 deleting own test fails even when another test runs the lines", async () => {
    const p = project([F], {
      [F]: PURE,
      "src/demo/calc.test.ts": OWN_FULL,
      "src/demo/other.test.ts": OTHER,
    });
    const before = await p.make("test-coverage");
    expect(before.code).toBe(0);
    rmSync(join(p.root, "src/demo/calc.test.ts"));
    const r = await p.make("test-coverage");
    const line = r.out
      .split("\n")
      .find((l) => /^(ok|FAIL)\s/.test(l) && l.includes(F));
    expect(line).toContain("0.0%");
    expect(r.out).toContain("src/demo/calc.test.ts");
    expect(r.code).not.toBe(0);
  }, 180000);

  test("02.3 pure file under 90% fails", async () => {
    const p = project([F], { [F]: PURE, "src/demo/calc.test.ts": OWN_PART });
    const r = await p.make("test-coverage");
    const line = r.out
      .split("\n")
      .find((l) => /^(ok|FAIL)\s/.test(l) && l.includes(F));
    expect(line).toMatch(/\d+\.\d%/);
    expect(line).not.toContain("100.0%");
    expect(r.code).not.toBe(0);
  }, 120000);

  test("02.4 type-only pure file passes", async () => {
    const p = project([F], {
      [F]: "export type Shape = { name: string };\nexport interface Named { name: string }\n",
      "src/demo/other.test.ts": `import { expect, test } from "bun:test";\ntest("x", () => { expect(1).toBe(1); });\n`,
    });
    const r = await p.make("test-coverage");
    const line = r.out
      .split("\n")
      .find((l) => /^(ok|FAIL)\s/.test(l) && l.includes(F));
    expect(line).toMatch(/^ok/);
    expect(r.code).toBe(0);
  }, 120000);

  test("02.5 make test never runs the gate", async () => {
    const p = project([F], {
      [F]: PURE,
      "src/demo/other.test.ts": OTHER,
    });
    const r = await p.make("test");
    expect(r.out).toMatch(/1 pass/);
    expect(r.out).not.toMatch(/^(ok|FAIL)\s+\d/m);
    expect(r.out).not.toContain("missing test file");
    expect(r.code).toBe(0);
  }, 120000);
});
