import { expect, test } from "bun:test";
import {
  AREAS,
  type Finding,
  isBlocking,
  parseFindings,
  reviewFailureText,
  where,
} from "./review.ts";
import { reviewPrompt } from "./review-prompt.ts";

test("each of the five areas has its own reviewer role", () => {
  expect(AREAS.map((a) => a.role)).toEqual([
    "reviewer-design",
    "reviewer-maintainability",
    "reviewer-tests",
    "reviewer-security",
    "reviewer-performance",
  ]);
});

const reply = (findings: unknown[]) => JSON.stringify({ findings });

test("a finding carries its severity, place, impact and fix, and the area of the reviewer", () => {
  const parsed = parseFindings(
    reply([{ severity: "high", file: "a.ts", line: 4, impact: "i", fix: "f" }]),
    "security",
  );
  expect(parsed).toEqual({
    ok: true,
    findings: [
      {
        area: "security",
        severity: "HIGH",
        file: "a.ts",
        line: 4,
        impact: "i",
        fix: "f",
      },
    ],
  });
});

test("an empty list is a review with no finding, and a reply with no list is broken", () => {
  expect(parseFindings(reply([]), "design")).toEqual({
    ok: true,
    findings: [],
  });
  expect(parseFindings("fine", "design").ok).toBe(false);
});

test("a missing field is empty and an unknown severity is kept as written", () => {
  const parsed = parseFindings(
    reply([
      "junk",
      { severity: "trivial" },
      {},
      { severity: "LOW", line: "x" },
    ]),
    "tests",
  );
  expect(
    parsed.ok && parsed.findings.map((f) => [f.severity, f.file, f.line]),
  ).toEqual([
    ["trivial", "", null],
    ["UNKNOWN", "", null],
    ["LOW", "", null],
  ]);
});

const finding = (
  severity: string,
  file = "a.ts",
  line: number | null = 1,
): Finding => ({
  area: "design",
  severity,
  file,
  line,
  impact: "bad",
  fix: "change it",
});

test("only CRITICAL and HIGH block", () => {
  expect(["CRITICAL", "HIGH"].map((s) => isBlocking(finding(s)))).toEqual([
    true,
    true,
  ]);
  expect(
    ["MEDIUM", "LOW", "trivial", "UNKNOWN"].map((s) => isBlocking(finding(s))),
  ).toEqual([false, false, false, false]);
});

test("a place is the file and line, the file alone, or no file", () => {
  expect(where(finding("LOW"))).toBe("a.ts:1");
  expect(where(finding("LOW", "a.ts", null))).toBe("a.ts");
  expect(where(finding("LOW", "", null))).toBe("no file");
});

test("the failure text names the area, severity, place, impact and fix", () => {
  const text = reviewFailureText([finding("HIGH")]);
  expect(text).toContain("this finding");
  expect(text).toContain("[design] HIGH at a.ts:1: bad");
  expect(text).toContain("fix: change it");
  expect(reviewFailureText([finding("HIGH"), finding("CRITICAL")])).toContain(
    "these findings",
  );
});

test("a reviewer prompt holds one area and the diff command", () => {
  const prompt = reviewPrompt(AREAS[3], "abc123");
  expect(prompt).toContain("security reviewer");
  expect(prompt).toContain("input validation");
  expect(prompt).not.toContain("module boundaries");
  expect(prompt).toContain("git diff abc123");
  expect(prompt).toContain('"findings"');
});
