/**
 * The grade of one pass: the reply of the grader, the score of every line, and the verdict with the
 * last-pass deferral of small gaps (#lp-prod-judge, #st-grade-converge, #st-grade-defer). Pure.
 */
import type { LineKind, LineSpec } from "./grade-lines.ts";
import { isObject, jsonOf } from "./reply-json.ts";

/** A score of at least this passes a line. */
export const PASS_SCORE = 3;
/** A line one point under a pass is a small gap, when the other conditions of #st-grade-defer hold. */
const SMALL_SCORE = PASS_SCORE - 1;

export type LineReply = {
  score: number;
  gap: string;
  /** The diff builds the card of a contradiction line. */
  builds: boolean;
  /** Only a person can settle the gap. */
  person: boolean;
  /** A line that passed at the earlier grade is broken by the later changes. */
  regression: boolean;
};

export type GradeLine = {
  id: string;
  kind: LineKind;
  text: string;
  card?: string;
  /** 0 when the grader left the line out. */
  score: number;
  gap: string;
  builds: boolean;
  person: boolean;
  failed: boolean;
};

export type Grade = { lines: GradeLine[] };

export type ParsedReply =
  | { ok: true; lines: Map<string, LineReply> }
  | { ok: false; error: string };

/** Reads the reply of the grader. A line that the ticket has not got is ignored; the first entry of a line counts. */
export function parseGradeReply(
  text: string,
  specs: readonly LineSpec[],
): ParsedReply {
  const data = jsonOf(text);
  if (!isObject(data) || !Array.isArray(data.lines))
    return {
      ok: false,
      error: 'the reply has no JSON object with a "lines" list',
    };
  const known = new Set(specs.map((spec) => spec.id));
  const lines = new Map<string, LineReply>();
  for (const entry of data.lines) {
    if (!isObject(entry) || typeof entry.line !== "string") continue;
    if (!known.has(entry.line) || lines.has(entry.line)) continue;
    const score = entry.score;
    if (
      typeof score !== "number" ||
      !Number.isInteger(score) ||
      score < 1 ||
      score > 5
    )
      return {
        ok: false,
        error: `line ${entry.line} needs a whole score from 1 to 5`,
      };
    const gap = typeof entry.gap === "string" ? entry.gap.trim() : "";
    if (score < PASS_SCORE && gap === "")
      return {
        ok: false,
        error: `line ${entry.line} fails with no gap, so the builder has nothing to fix`,
      };
    lines.set(entry.line, {
      score,
      gap,
      builds: entry.builds === true,
      person: entry.person === true,
      regression: entry.regression === true,
    });
  }
  return { ok: true, lines };
}

/**
 * Scores every line of the ticket. A line the reply leaves out scores 0. At a later grade, a line
 * that passed before fails only when the grader names a regression there (#st-grade-converge).
 */
export function settleGrade(
  specs: readonly LineSpec[],
  reply: ReadonlyMap<string, LineReply>,
  previous: Grade | null,
): Grade {
  const lines = specs.map((spec): GradeLine => {
    const given = reply.get(spec.id);
    const before = previous?.lines.find((line) => line.id === spec.id);
    const low = (given?.score ?? 0) < PASS_SCORE;
    const forgiven =
      low &&
      given !== undefined &&
      before !== undefined &&
      !before.failed &&
      !given.regression;
    return {
      id: spec.id,
      kind: spec.kind,
      text: spec.text,
      ...(spec.card === undefined ? {} : { card: spec.card }),
      score: given?.score ?? 0,
      gap: given?.gap ?? "the grader left this line out",
      builds: given?.builds ?? false,
      person: given?.person ?? false,
      failed: low && !forgiven,
    };
  });
  return { lines };
}

/** A failed contradiction line on a card the diff builds, one point under a pass, that no person must settle. */
export function isSmallGap(line: GradeLine): boolean {
  return (
    line.failed &&
    line.kind === "contradiction" &&
    line.score === SMALL_SCORE &&
    line.builds &&
    !line.person
  );
}

export type GradeVerdict = {
  green: boolean;
  /** The lines that fail the pass. */
  blocking: GradeLine[];
  /** The small gaps of a last counted pass, which count as green and become a follow-up. */
  deferred: GradeLine[];
};

export function judgeGrade(grade: Grade, lastCounted: boolean): GradeVerdict {
  const failed = grade.lines.filter((line) => line.failed);
  if (failed.length === 0) return { green: true, blocking: [], deferred: [] };
  if (lastCounted && failed.every(isSmallGap))
    return { green: true, blocking: [], deferred: failed };
  return { green: false, blocking: failed, deferred: [] };
}

/** What the next builder pass reads about the failed lines. */
export function gradeFailureText(lines: readonly GradeLine[]): string {
  const body = lines.map(
    (line) =>
      `- ${line.id} (${line.kind}, score ${line.score}): ${line.text}\n  gap: ${line.gap}`,
  );
  return `The grader failed ${lines.length === 1 ? "this line" : "these lines"}:\n${body.join("\n")}`;
}
