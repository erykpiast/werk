import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { leanCopy, sh } from "./repo-copy.ts";

const PURE = "src/zz/pure.ts";
const SOURCE = `export function sign(n: number): string {
  if (n < 0) {
    return "neg";
  }
  if (n === 0) {
    return "zero";
  }
  return "pos";
}
`;
const FULL_TEST = `import { expect, test } from "bun:test";
import { sign } from "./pure.ts";
test("sign", () => {
  expect(sign(-1)).toBe("neg");
  expect(sign(0)).toBe("zero");
  expect(sign(1)).toBe("pos");
});
`;
const PART_TEST = `import { expect, test } from "bun:test";
import { sign } from "./pure.ts";
test("sign", () => {
  expect(sign(1)).toBe("pos");
});
`;
const OTHER_TEST = `import { expect, test } from "bun:test";
import { sign } from "./pure.ts";
test("other file runs every line", () => {
  expect(sign(-1)).toBe("neg");
  expect(sign(0)).toBe("zero");
  expect(sign(1)).toBe("pos");
});
`;
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});
function project(list: string[]) {
  const p = leanCopy(list);
  disposers.push(p.dispose);
  p.write("src/zz/unit.test.ts", `import { expect, test } from "bun:test";\ntest("unit", () => expect(1).toBe(1));\n`);
  return p;
}

test("02.1 a pure file covered by its own test passes the gate", async () => {
  const p = project([PURE]);
  p.write(PURE, SOURCE);
  p.write("src/zz/pure.test.ts", FULL_TEST);
  const r = await sh(["make", "test-coverage"], p.dir);
  const lines = r.stdout.split("\n").filter((l) => l.includes(PURE) && /%\s+src\/zz\/pure\.ts/.test(l));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("100.0%");
  expect(r.code).toBe(0);
}, 120000);

test("02.2 deleting the own test fails the file at 0% although another test runs it", async () => {
  const p = project([PURE]);
  p.write(PURE, SOURCE);
  p.write("src/zz/pure.test.ts", FULL_TEST);
  p.write("src/zz/other.test.ts", OTHER_TEST);
  const before = await sh(["make", "test-coverage"], p.dir);
  expect(before.stdout).toContain("100.0%");
  rmSync(join(p.dir, "src/zz/pure.test.ts"));
  const r = await sh(["make", "test-coverage"], p.dir);
  expect(r.stdout).toMatch(/0\.0%\s+src\/zz\/pure\.ts/);
  expect(r.stdout).toContain("src/zz/pure.test.ts");
  expect(r.code).not.toBe(0);
}, 120000);

test("02.3 a pure file under 90% fails the gate", async () => {
  const p = project([PURE]);
  p.write(PURE, SOURCE);
  p.write("src/zz/pure.test.ts", PART_TEST);
  const r = await sh(["make", "test-coverage"], p.dir);
  expect(r.stdout).toMatch(/\d+\.\d%\s+src\/zz\/pure\.ts/);
  expect(r.stdout).toContain("FAIL");
  expect(r.code).not.toBe(0);
}, 120000);

test("02.4 a pure file of type declarations only passes", async () => {
  const p = project(["src/zz/shape.ts"]);
  p.write("src/zz/shape.ts", "export type Shape = { name: string };\nexport interface Named { name: string }\n");
  const r = await sh(["make", "test-coverage"], p.dir);
  expect(r.stdout).toMatch(/ok\s+100\.0%\s+src\/zz\/shape\.ts/);
  expect(r.code).toBe(0);
}, 120000);

test("02.5 a plain test run never runs the gate", async () => {
  const p = project([PURE]);
  p.write(PURE, SOURCE);
  const r = await sh(["make", "test"], p.dir);
  expect(r.all).toMatch(/\d+ pass/);
  expect(r.all).toContain("0 fail");
  expect(r.all).not.toContain("src/zz/pure.ts");
  expect(r.all).not.toContain("pure.test.ts");
  expect(r.all).not.toContain("missing test file");
  expect(r.code).toBe(0);
}, 120000);
