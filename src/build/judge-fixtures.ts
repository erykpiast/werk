import type { Reply, Script } from "../fake-agent/script.ts";

export const result = (text: string): Reply => [
  {
    event: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
    },
  },
];
export const line = (id: string, score: number, gap = "", more = {}) => ({
  line: id,
  score,
  gap,
  ...more,
});
export const gradeOf = (...lines: unknown[]): Reply =>
  result(JSON.stringify({ lines }));
export const ALL_GOOD = gradeOf(
  line("criterion-1", 4),
  line("card-top", 4),
  line("scope", 5),
);
export const findingsOf = (...findings: unknown[]): Reply =>
  result(JSON.stringify({ findings }));
export const AREA_ROLES = [
  "reviewer-design",
  "reviewer-maintainability",
  "reviewer-tests",
  "reviewer-security",
  "reviewer-performance",
];
export type Judging = { grades?: Reply[]; reviews?: Record<string, Reply[]> };
/** A script with the builder replies, and a grader and five reviewers that find nothing unless the test says so. */
export const judgeRoles = (judging: Judging = {}) => ({
  grader: { replies: judging.grades ?? Array(5).fill(ALL_GOOD) },
  ...Object.fromEntries(
    AREA_ROLES.map((role) => [
      role,
      { replies: judging.reviews?.[role] ?? Array(5).fill(findingsOf()) },
    ]),
  ),
});
export const withJudges = (builds: Reply[], judging: Judging = {}): Script => ({
  roles: { builder: { replies: builds }, ...judgeRoles(judging) },
});
