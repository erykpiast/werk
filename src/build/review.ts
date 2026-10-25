/**
 * The quality review: five areas, one reviewer role each, the findings of a reply, and the verdict
 * (#lp-prod-review, #st-build-seam-role-env-reviewer-area). Pure.
 */
import { isObject, jsonOf } from "./reply-json.ts";

export const AREAS = [
  {
    area: "design",
    role: "reviewer-design",
    focus:
      "module boundaries, coupling, error handling, and fit with the code around it",
  },
  {
    area: "maintainability",
    role: "reviewer-maintainability",
    focus:
      "duplication, complexity, dead code, and escape hatches such as type or lint suppressions and skipped tests",
  },
  {
    area: "tests",
    role: "reviewer-tests",
    focus:
      "assertions that fail without the change, edge cases, failure paths, and any test that the change made weaker",
  },
  {
    area: "security",
    role: "reviewer-security",
    focus:
      "input validation, secret handling, and each new dependency with the reason for it",
  },
  {
    area: "performance",
    role: "reviewer-performance",
    focus: "extra work, expensive queries, and unbounded loops on the input",
  },
] as const;
export type Area = (typeof AREAS)[number];

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
/** The severities that fail the pass. */
const BLOCKING: readonly string[] = ["CRITICAL", "HIGH"];

export type Finding = {
  area: string;
  /** One of the four severities, or the text the reviewer wrote when it is none of them. */
  severity: string;
  file: string;
  line: number | null;
  impact: string;
  fix: string;
};

/** A reviewer whose reply holds no readable findings list is a broken step. */
export type ParsedFindings =
  | { ok: true; findings: Finding[] }
  | { ok: false; error: string };

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function parseFindings(reply: string, area: string): ParsedFindings {
  const data = jsonOf(reply);
  if (!isObject(data) || !Array.isArray(data.findings))
    return {
      ok: false,
      error: 'the reply has no JSON object with a "findings" list',
    };
  const findings: Finding[] = [];
  for (const entry of data.findings) {
    if (!isObject(entry)) continue;
    const severity = text(entry.severity);
    const upper = severity.toUpperCase();
    findings.push({
      area,
      severity: SEVERITIES.some((known) => known === upper)
        ? upper
        : severity || "UNKNOWN",
      file: text(entry.file),
      line:
        typeof entry.line === "number" && Number.isFinite(entry.line)
          ? entry.line
          : null,
      impact: text(entry.impact),
      fix: text(entry.fix),
    });
  }
  return { ok: true, findings };
}

/** CRITICAL and HIGH fail the pass. Every other severity, an unknown one too, is only recorded. */
export const isBlocking = (finding: Finding): boolean =>
  BLOCKING.includes(finding.severity);

export const where = (finding: Finding): string =>
  finding.file === ""
    ? "no file"
    : `${finding.file}${finding.line === null ? "" : `:${finding.line}`}`;

/** What the next builder pass reads about the blocking findings. */
export function reviewFailureText(findings: readonly Finding[]): string {
  const body = findings.map(
    (finding) =>
      `- [${finding.area}] ${finding.severity} at ${where(finding)}: ${finding.impact}\n  fix: ${finding.fix}`,
  );
  return `The review failed on ${findings.length === 1 ? "this finding" : "these findings"}:\n${body.join("\n")}`;
}
