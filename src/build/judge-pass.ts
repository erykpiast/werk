/**
 * The judging of one green pass: the grader first, then the five reviewers at the same time, and a stop
 * at the first red (#st-build-ticket-order, #lp-prod-judge, #lp-prod-review). A broken or silent judge
 * fails the pass as a failed step.
 */
import type { LaunchOptions } from "../agent/launch-options.ts";
import { writeDetailFile } from "../pipeline/log-store.ts";
import {
  type Grade,
  type GradeLine,
  gradeFailureText,
  judgeGrade,
  parseGradeReply,
  settleGrade,
} from "./grade.ts";
import { type GradePromptInput, gradePrompt } from "./grade-prompt.ts";
import { runJudge } from "./judge-run.ts";
import {
  AREAS,
  type Finding,
  isBlocking,
  parseFindings,
  reviewFailureText,
  where,
} from "./review.ts";
import { reviewPrompt } from "./review-prompt.ts";

export type JudgeContext = {
  /** The worktree of the pass and the commit it branched from. */
  dir: string;
  base: string;
  env: Record<string, string | undefined>;
  pipelineLog: string;
  buildId: string;
  ticket: string;
  timeoutMs: number;
  silenceMs: number;
  signal: AbortSignal;
  launchFor: (role: string) => LaunchOptions;
};

/** What the grader reads about the ticket. The same on every pass of a build. */
export type Grading = Omit<GradePromptInput, "base" | "previous">;

export type Judged = {
  grade: Grade | null;
  /** The small gaps of a last counted pass that count as green. */
  deferred: GradeLine[];
  /** The detail file that holds every finding of the review, relative to the folder of the log. */
  findings: string | null;
};

export type JudgeOutcome =
  | { kind: "green"; judged: Judged }
  | {
      kind: "red";
      gate: "grader" | "reviewer";
      reason: string;
      /** What the next builder pass reads. */
      text: string;
      judged: Judged;
    }
  | { kind: "archived" };

export async function judgePass(
  ctx: JudgeContext,
  n: number,
  grading: Grading,
  previous: Grade | null,
  lastCounted: boolean,
): Promise<JudgeOutcome> {
  const run = (step: "grader" | "reviewer", role: string, prompt: string) =>
    runJudge({
      id: `${ctx.buildId}:p${n}:${role}`,
      step,
      prompt,
      cwd: ctx.dir,
      launch: ctx.launchFor(role),
      env: ctx.env,
      pipelineLog: ctx.pipelineLog,
      fields: { build: ctx.buildId, ticket: ctx.ticket, pass: n },
      timeoutMs: ctx.timeoutMs,
      silenceMs: ctx.silenceMs,
      signal: ctx.signal,
    });
  const red = (
    gate: "grader" | "reviewer",
    reason: string,
    text: string,
    judged: Judged,
  ): JudgeOutcome => ({ kind: "red", gate, reason, text, judged });

  const graded = await run(
    "grader",
    "grader",
    gradePrompt({ ...grading, base: ctx.base, previous }),
  );
  if (ctx.signal.aborted) return { kind: "archived" };
  const none: Judged = { grade: null, deferred: [], findings: null };
  if (!graded.ok) {
    const reason = `the grader failed: ${graded.reason}`;
    return red("grader", reason, reason, none);
  }
  const parsed = parseGradeReply(graded.text, grading.specs);
  if (!parsed.ok) {
    const reason = `the grader's reply is broken: ${parsed.error}`;
    return red("grader", reason, reason, none);
  }
  const grade = settleGrade(grading.specs, parsed.lines, previous);
  const verdict = judgeGrade(grade, lastCounted);
  const judged: Judged = { grade, deferred: verdict.deferred, findings: null };
  if (!verdict.green) {
    const ids = verdict.blocking.map((line) => line.id).join(", ");
    return red(
      "grader",
      `the grade failed on ${ids}`,
      gradeFailureText(verdict.blocking),
      judged,
    );
  }

  const reviews = await Promise.all(
    AREAS.map(async (area) => ({
      area,
      result: await run("reviewer", area.role, reviewPrompt(area, ctx.base)),
    })),
  );
  if (ctx.signal.aborted) return { kind: "archived" };

  const broken: string[] = [];
  const findings: Finding[] = [];
  for (const { area, result } of reviews) {
    if (!result.ok) {
      broken.push(`the ${area.role} failed: ${result.reason}`);
      continue;
    }
    const read = parseFindings(result.text, area.area);
    if (read.ok) findings.push(...read.findings);
    else broken.push(`the ${area.role}'s reply is broken: ${read.error}`);
  }
  // Every finding is recorded. Only CRITICAL and HIGH fail the pass.
  const recorded =
    findings.length === 0
      ? null
      : writeDetailFile(
          ctx.pipelineLog,
          `${ctx.buildId}:p${n}:findings`,
          "json",
          JSON.stringify(findings, null, 2),
        );
  const reviewed: Judged = { ...judged, findings: recorded };
  const blocking = findings.filter(isBlocking);
  if (broken.length === 0 && blocking.length === 0)
    return { kind: "green", judged: reviewed };
  const text = [
    ...broken,
    ...(blocking.length > 0 ? [reviewFailureText(blocking)] : []),
  ].join("\n");
  const reason = [
    ...broken,
    ...blocking.map(
      (finding) => `${finding.area} ${finding.severity} at ${where(finding)}`,
    ),
  ].join("; ");
  return red("reviewer", reason, text, reviewed);
}
