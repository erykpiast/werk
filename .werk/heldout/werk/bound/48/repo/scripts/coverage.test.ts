import { describe, expect, test } from "bun:test";
import { formatResult, judge, lineCoverage, ownTestFile, parseLcov, parsePureList } from "./coverage";

describe("parsePureList", () => {
  test("keeps one path per line and skips blank lines and comments", () => {
    const text = "# pure files\nsrc/a.ts\n\n  src/b.ts  \n# src/c.ts\n";
    expect(parsePureList(text)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("lists a file once when the list repeats it", () => {
    expect(parsePureList("src/a.ts\nsrc/a.ts\n")).toEqual(["src/a.ts"]);
  });
});

describe("ownTestFile", () => {
  test("puts .test before the extension, in the same folder", () => {
    expect(ownTestFile("src/fold.ts")).toBe("src/fold.test.ts");
    expect(ownTestFile("web/Card.tsx")).toBe("web/Card.test.tsx");
  });
});

describe("parseLcov", () => {
  test("reads the lines found and hit of each source file", () => {
    const lcov = [
      "TN:",
      "SF:src/a.ts",
      "DA:1,1",
      "DA:2,0",
      "LF:2",
      "LH:1",
      "end_of_record",
      "SF:src/b.ts",
      "LF:4",
      "LH:4",
      "end_of_record",
    ].join("\n");
    const records = parseLcov(lcov);
    expect(records.get("src/a.ts")).toEqual({ found: 2, hit: 1 });
    expect(records.get("src/b.ts")).toEqual({ found: 4, hit: 4 });
  });

  test("returns no records for an empty report", () => {
    expect(parseLcov("").size).toBe(0);
  });
});

describe("lineCoverage", () => {
  test("is the share of executable lines that ran, in percent", () => {
    expect(lineCoverage({ found: 4, hit: 3 })).toBe(75);
  });

  test("is 100 for a file with no executable lines", () => {
    expect(lineCoverage({ found: 0, hit: 0 })).toBe(100);
  });
});

describe("judge", () => {
  const base = { file: "src/a.ts", testFile: "src/a.test.ts", threshold: 90 };

  test("passes a file at or above the threshold", () => {
    const result = judge({ ...base, executable: true, hasOwnTest: true, record: { found: 10, hit: 9 } });
    expect(result).toEqual({ file: "src/a.ts", percent: 90, pass: true, reason: undefined });
  });

  test("fails a file below the threshold, on its own numbers", () => {
    const result = judge({ ...base, executable: true, hasOwnTest: true, record: { found: 10, hit: 8 } });
    expect(result.pass).toBe(false);
    expect(result.percent).toBe(80);
  });

  test("fails a file with no own test file at 0% and names the missing test file", () => {
    const result = judge({ ...base, executable: true, hasOwnTest: false, record: { found: 10, hit: 10 } });
    expect(result).toEqual({
      file: "src/a.ts",
      percent: 0,
      pass: false,
      reason: "missing own test file src/a.test.ts",
    });
  });

  test("fails a file that its own test run never loaded at 0%", () => {
    const result = judge({ ...base, executable: true, hasOwnTest: true, record: undefined });
    expect(result).toEqual({
      file: "src/a.ts",
      percent: 0,
      pass: false,
      reason: "src/a.test.ts never loads it",
    });
  });

  test("fails a file whose own tests fail, whatever its coverage", () => {
    const result = judge({
      ...base,
      executable: true,
      hasOwnTest: true,
      testsFailed: true,
      record: { found: 10, hit: 10 },
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("src/a.test.ts fails");
  });

  test("passes a file with no executable lines, also with no own test file", () => {
    const result = judge({ ...base, executable: false, hasOwnTest: false, record: undefined });
    expect(result).toEqual({ file: "src/a.ts", percent: 100, pass: true, reason: "no executable lines" });
  });
});

describe("formatResult", () => {
  test("prints the verdict, the percentage and the file on one line", () => {
    expect(formatResult({ file: "src/a.ts", percent: 87.5, pass: false, reason: undefined })).toBe(
      "FAIL   87.50%  src/a.ts",
    );
  });

  test("adds the reason after the file", () => {
    expect(
      formatResult({ file: "src/a.ts", percent: 0, pass: false, reason: "missing own test file src/a.test.ts" }),
    ).toBe("FAIL    0.00%  src/a.ts  (missing own test file src/a.test.ts)");
    expect(formatResult({ file: "src/b.ts", percent: 100, pass: true, reason: undefined })).toBe(
      "ok    100.00%  src/b.ts",
    );
  });
});
