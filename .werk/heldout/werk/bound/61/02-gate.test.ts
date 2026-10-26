import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { type Mini, mini } from "./mini.ts";

let m: Mini;
afterEach(() => m?.dispose());

const FULL = `export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function neg(a: number): number {\n  return -a;\n}\n`;
const FULL_TEST = `import { expect, test } from "bun:test";\nimport { add, neg } from "./calc.ts";\ntest("calc", () => { expect(add(1, 2)).toBe(3); expect(neg(1)).toBe(-1); });\n`;

test("02.1 a pure file with its own full test passes at 100%", async () => {
  m = mini();
  m.write("src/pure/calc.ts", FULL);
  m.write("src/pure/calc.test.ts", FULL_TEST);
  m.list(["src/pure/calc.ts"]);
  const r = await m.make("test-coverage");
  expect(r.out).toMatch(/ok\s+100\.0%\s+src\/pure\/calc\.ts/);
  expect(r.code).toBe(0);
});

test("02.2 deleting the own test fails at 0% and names the test, though another test runs the lines", async () => {
  m = mini();
  m.write("src/pure/calc.ts", FULL);
  m.write("src/pure/calc.test.ts", FULL_TEST);
  m.write("src/pure/other.test.ts", `import { expect, test } from "bun:test";\nimport { add, neg } from "./calc.ts";\ntest("other", () => { expect(add(1, 2)).toBe(3); expect(neg(1)).toBe(-1); });\n`);
  m.list(["src/pure/calc.ts"]);
  expect((await m.make("test-coverage")).code).toBe(0);
  rmSync(join(m.dir, "src/pure/calc.test.ts"));
  const r = await m.make("test-coverage");
  expect(r.out).toMatch(/FAIL\s+0\.0%\s+src\/pure\/calc\.ts/);
  expect(r.out).toContain("src/pure/calc.test.ts");
  expect(r.code).not.toBe(0);
});

test("02.3 a pure file under 90% fails and shows its percentage", async () => {
  m = mini();
  m.write("src/pure/calc.ts", FULL);
  m.write("src/pure/calc.test.ts", `import { expect, test } from "bun:test";\nimport { add } from "./calc.ts";\ntest("calc", () => { expect(add(1, 2)).toBe(3); });\n`);
  m.list(["src/pure/calc.ts"]);
  const r = await m.make("test-coverage");
  expect(r.out).toMatch(/FAIL\s+\d+\.\d%\s+src\/pure\/calc\.ts/);
  expect(r.code).not.toBe(0);
});

test("02.4 a pure file of type declarations only passes", async () => {
  m = mini();
  m.write("src/pure/shape.ts", `export type Shape = { name: string };\nexport interface Named { name: string }\n`);
  m.write("src/pure/ok.test.ts", `import { expect, test } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n`);
  m.list(["src/pure/shape.ts"]);
  const r = await m.make("test-coverage");
  expect(r.out).toMatch(/ok\s+100\.0%\s+src\/pure\/shape\.ts/);
  expect(r.code).toBe(0);
});

test("02.5 make test never runs the gate and does not report a missing test file", async () => {
  m = mini();
  m.write("src/pure/calc.ts", FULL);
  m.write("src/pure/ok.test.ts", `import { expect, test } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n`);
  m.list(["src/pure/calc.ts"]);
  const r = await m.make("test");
  expect(r.code).toBe(0);
  expect(r.out).toContain("1 pass");
  expect(r.out).not.toContain("src/pure/calc.ts");
  expect(r.out).not.toContain("missing test file");
  expect(r.out).not.toContain("%");
});
