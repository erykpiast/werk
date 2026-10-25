/** The follow-up ticket of the small gaps that a last counted pass leaves (#st-grade-defer). Pure. */
import type { GradeLine } from "./grade.ts";

export type FollowupSource = {
  /** The id of the ticket whose gaps these are. */
  id: string;
  title: string;
  /** The touches line of that ticket. */
  touches: string;
  checks: readonly string[];
};

/** The title of the follow-up of a ticket. */
export const followupTitle = (source: FollowupSource): string =>
  `Close the gaps the grader found in ${source.title}`;

/** The first number from 1 to 99 that no ticket of the plan holds, as two digits. Null when all are taken. */
export function nextNumber(taken: Iterable<string>): string | null {
  const used = new Set([...taken].map(Number));
  for (let n = 1; n <= 99; n++) {
    if (!used.has(n)) return String(n).padStart(2, "0");
  }
  return null;
}

/** The ticket file: it cites the cards of the gaps, quotes each gap as the grader wrote it, and checks as its source does. */
export function followupText(
  source: FollowupSource,
  gaps: readonly GradeLine[],
): string {
  const cites = [
    ...new Set(
      gaps.flatMap((gap) => (gap.card === undefined ? [] : [gap.card])),
    ),
  ];
  const quote = (gap: GradeLine) =>
    `${gap.card === undefined ? gap.id : `#${gap.card}`}: "${gap.gap.replace(/\s*\n\s*/g, " ")}"`;
  const lines = [
    `title: ${followupTitle(source)}`,
    `cites: ${cites.join(", ")}`,
    `blocked_by:`,
    `stories:`,
    `touches: ${source.touches}`,
    ``,
    `## What to build`,
    ``,
    `Ticket ${source.id} merged with small gaps that the grader found on its last pass. Close each gap. The grader wrote them as follows.`,
    ``,
    ...gaps.map((gap) => `- ${quote(gap)}`),
    ``,
    `## Acceptance criteria`,
    ``,
    ...gaps.map((gap) => `- [ ] The gap is closed. ${quote(gap)}`),
    ``,
    `## Checks`,
    ``,
    ...source.checks.map((check) => `- \`${check}\``),
    ``,
  ];
  return lines.join("\n");
}
