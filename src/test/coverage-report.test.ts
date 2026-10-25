import { expect, test } from "bun:test";
import {
  formatLine,
  hasExecutableCode,
  judge,
  lineCounts,
  ownTestPath,
  uniqueFiles,
} from "./coverage-report";

const record = (file: string, hits: number[]) =>
  `TN:\nSF:${file}\n${hits.map((h, i) => `DA:${i + 1},${h}`).join("\n")}\nLF:${hits.length}\nend_of_record\n`;

test("the own test file sits beside the file with .test before the extension", () => {
  expect(ownTestPath("src/a.ts")).toBe("src/a.test.ts");
  expect(ownTestPath("src/noext")).toBe("src/noext.test");
  expect(ownTestPath("a.b/noext")).toBe("a.b/noext.test");
});

test("a file listed twice is judged once", () => {
  expect(uniqueFiles(["a", "b", "a"])).toEqual(["a", "b"]);
});

test("lineCounts counts only the record of the named file", () => {
  const lcov = record("src/a.ts", [1, 0]) + record("src/b.ts", [1, 1, 1]);
  expect(lineCounts(lcov, "src/a.ts")).toEqual({ found: 2, hit: 1 });
  expect(lineCounts(lcov, "src/c.ts")).toBeNull();
});

test("lineCounts matches an absolute path that ends in the file", () => {
  expect(lineCounts(record("/w/src/a.ts", [1]), "src/a.ts")).toEqual({
    found: 1,
    hit: 1,
  });
});

test("a file at 100% from its own test passes", () => {
  const r = judge("src/a.ts", record("src/a.ts", [1, 2]));
  expect(r.pass).toBe(true);
  expect(r.percent).toBe(100);
});

test("a file at 90% passes and a file under 90% fails", () => {
  const ten = (hit: number) =>
    record("src/a.ts", [...Array(hit).fill(1), ...Array(10 - hit).fill(0)]);
  expect(judge("src/a.ts", ten(9)).pass).toBe(true);
  expect(judge("src/a.ts", ten(8)).pass).toBe(false);
});

test("a file with no own test file is 0% and names the missing test file", () => {
  const r = judge("src/a.ts", null);
  expect(r.pass).toBe(false);
  expect(r.percent).toBe(0);
  expect(formatLine(r)).toContain("src/a.test.ts");
});

test("a file that its own test never loads is 0%", () => {
  const r = judge("src/a.ts", record("src/b.ts", [1]));
  expect(r.pass).toBe(false);
  expect(r.percent).toBe(0);
});

test("a file with no executable lines passes", () => {
  const r = judge(
    "src/types.ts",
    "SF:src/types.ts\nLF:0\nLH:0\nend_of_record\n",
  );
  expect(r.pass).toBe(true);
});

test("a line shows its percentage and its verdict", () => {
  expect(formatLine({ file: "src/a.ts", percent: 100, pass: true })).toBe(
    "ok   100.0%  src/a.ts",
  );
});

test("type declarations have no executable code and statements do", () => {
  expect(
    hasExecutableCode("export type A = { a: 1 };\nexport interface B {}"),
  ).toBe(false);
  expect(
    hasExecutableCode("import type { A } from './a';\nexport type B = A;"),
  ).toBe(false);
  expect(hasExecutableCode("export const a = 1;")).toBe(true);
});
