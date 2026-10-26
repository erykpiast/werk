import { afterAll, expect, test } from "bun:test";
import { rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { has, make, makeGateProject, put } from "./gate-project.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const project = (pure: string[]) => {
  const dir = makeGateProject(pure);
  dirs.push(dir);
  return dir;
};

const PURE = `export const double = (n: number) => n * 2;
export function greet(name: string) {
  return \`hello \${name}\`;
}
export function shout(name: string) {
  return greet(name).toUpperCase();
}
`;
const FULL_TEST = `import { expect, test } from "bun:test";
import { double, greet, shout } from "./calc.ts";
test("calc", () => {
  expect(double(2)).toBe(4);
  expect(greet("a")).toBe("hello a");
  expect(shout("a")).toBe("HELLO A");
});
`;
const OTHER_TEST = `import { expect, test } from "bun:test";
import { double, greet, shout } from "./calc.ts";
test("another file's test runs every line of calc", () => {
  expect([double(1), greet("b"), shout("b")].length).toBe(3);
});
`;
const lines = (out: string, file: string) =>
  out.split("\n").filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes(file));

test("02.1 a pure file covered by its own test shows one line at 100% and the run succeeds", async () => {
  const dir = project(["src/pure/calc.ts"]);
  put(dir, "src/pure/calc.ts", PURE);
  put(dir, "src/pure/calc.test.ts", FULL_TEST);
  const r = await make(dir, "test-coverage");
  const mine = lines(r.out, "src/pure/calc.ts");
  expect(mine.length).toBe(1);
  expect(mine[0]).toMatch(/^ok\s+100\.0%\s+src\/pure\/calc\.ts/);
  expect(r.code).toBe(0);
}, 120000);

test("02.2 deleting the own test fails the file at 0% even though another test runs its lines", async () => {
  const dir = project(["src/pure/calc.ts"]);
  put(dir, "src/pure/calc.ts", PURE);
  put(dir, "src/pure/calc.test.ts", FULL_TEST);
  put(dir, "src/other/other.test.ts", OTHER_TEST.replace("./calc.ts", "../pure/calc.ts"));
  const before = await make(dir, "test-coverage");
  expect(lines(before.out, "src/pure/calc.ts")[0]).toMatch(/100\.0%/);
  expect(before.code).toBe(0);
  unlinkSync(join(dir, "src/pure/calc.test.ts"));
  expect(has(dir, "src/pure/calc.test.ts")).toBe(false);
  const r = await make(dir, "test-coverage");
  const mine = lines(r.out, "src/pure/calc.ts");
  expect(mine.length).toBe(1);
  expect(mine[0]).toMatch(/^FAIL\s+0\.0%/);
  expect(r.out).toContain("src/pure/calc.test.ts");
  expect(r.code).not.toBe(0);
}, 120000);

test("02.3 a pure file under 90% fails the gate and shows its percentage", async () => {
  const dir = project(["src/pure/calc.ts"]);
  put(dir, "src/pure/calc.ts", PURE);
  put(
    dir,
    "src/pure/calc.test.ts",
    `import { expect, test } from "bun:test";
import { double } from "./calc.ts";
test("only double", () => {
  expect(double(2)).toBe(4);
});
`,
  );
  const r = await make(dir, "test-coverage");
  const mine = lines(r.out, "src/pure/calc.ts");
  expect(mine.length).toBe(1);
  expect(mine[0]).toMatch(/^FAIL\s+\d+\.\d%/);
  const pct = Number(/(\d+\.\d)%/.exec(mine[0] as string)?.[1]);
  expect(pct).toBeLessThan(90);
  expect(pct).toBeGreaterThan(0);
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a pure file of type declarations only passes", async () => {
  const dir = project(["src/pure/types.ts"]);
  put(
    dir,
    "src/pure/types.ts",
    "export type Shape = { name: string };\nexport interface Named {\n  name: string;\n}\n",
  );
  put(dir, "src/other.test.ts", `import { expect, test } from "bun:test";\ntest("x", () => expect(1).toBe(1));\n`);
  const r = await make(dir, "test-coverage");
  const mine = lines(r.out, "src/pure/types.ts");
  expect(mine.length).toBe(1);
  expect(mine[0]).toMatch(/^ok\s/);
  expect(r.code).toBe(0);
}, 120000);

test("02.5 plain make test never runs the gate and does not report the missing test file", async () => {
  const dir = project(["src/pure/calc.ts"]);
  put(dir, "src/pure/calc.ts", PURE);
  put(dir, "src/other.test.ts", `import { expect, test } from "bun:test";\ntest("x", () => expect(1).toBe(1));\n`);
  expect(has(dir, "src/pure/calc.test.ts")).toBe(false);
  const r = await make(dir, "test");
  expect(r.all).toMatch(/1 pass/);
  expect(r.code).toBe(0);
  expect(r.all).not.toContain("src/pure/calc");
  expect(r.all).not.toContain("calc.test.ts");
  expect(r.all).not.toMatch(/missing test file/);
  expect(r.all).not.toMatch(/^(ok|FAIL)\s+\d/m);
}, 120000);
