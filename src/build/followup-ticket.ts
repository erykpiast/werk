/** The follow-up ticket of the small gaps that a last counted pass leaves (#st-grade-defer). Pure. */
import { MAX_SIZE } from "../tickets/own-checks.ts";
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

const PATH_IN_TOKEN =
  /[\w.~*-]*\/(?:[\w.~*-]+\/)*([\w.*-]*\.[A-Za-z0-9]{1,5})/g;
/** Room that the header and the fixed text of a follow-up take from the size limit. */
const FIXED_ROOM = 800;

/** One gap on one line, with each file path cut to its bare file name, and cut to `max` characters. A ticket names no file paths (#st-ticket). */
export function quotableGap(gap: string, max: number): string {
  const flat = gap
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) =>
      word.includes("://") ? word : word.replace(PATH_IN_TOKEN, "$1"),
    )
    .join(" ");
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
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
  const room = Math.max(
    80,
    Math.floor((MAX_SIZE - FIXED_ROOM) / Math.max(1, gaps.length)) - 100,
  );
  const quote = (gap: GradeLine) =>
    `${gap.card === undefined ? gap.id : `#${gap.card}`}: "${quotableGap(gap.gap, room)}"`;
  const lines = [
    `title: ${followupTitle(source)}`,
    `cites: ${cites.join(", ")}`,
    `blocked_by:`,
    `stories:`,
    `touches: ${source.touches}`,
    ``,
    `## What to build`,
    ``,
    `Ticket ${source.id} merged with small gaps that the grader found on its last pass. Close each gap that the acceptance criteria quote.`,
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
