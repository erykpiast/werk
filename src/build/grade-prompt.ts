/** The prompt of the grader: the lines to score, the cards, the earlier gaps, and the reply format (#lp-prod-judge, #st-grade-converge). Pure. */
import type { CardBrief } from "./brief.ts";
import type { Grade } from "./grade.ts";
import type { LineSpec } from "./grade-lines.ts";

export type GradePromptInput = {
  /** The text of the ticket file. */
  ticket: string;
  stories: readonly string[];
  /** The decided cards of the depends_on closure, cited or not. */
  cards: readonly CardBrief[];
  specs: readonly LineSpec[];
  /** The commit that the worktree branched from. */
  base: string;
  /** The grade of the pass before, or null at the first grade of the build. */
  previous: Grade | null;
};

function cardSection(card: CardBrief): string {
  const parts = [`### #${card.id} — ${card.title}`, `why: ${card.why}`];
  if (card.body !== "") parts.push(card.body);
  return parts.join("\n");
}

function lineList(specs: readonly LineSpec[]): string {
  return specs
    .map((spec) => `- ${spec.id} (${spec.kind}): ${spec.text}`)
    .join("\n");
}

function earlier(previous: Grade | null): string {
  if (previous === null)
    return "This is the first grade of this build. Name every gap you find on every line, in this one answer.";
  const failed = previous.lines.filter((line) => line.failed);
  const passed = previous.lines.filter((line) => !line.failed);
  return [
    "This is a later grade of this build. Do not read the diff fresh.",
    "- A line that failed before: score it by whether its gap is still open. A closed gap passes.",
    '- A line that passed before: it fails only for a regression, something that worked at the earlier grade and that the later changes broke. Set "regression" to true on such a line. A gap that was already there at the earlier grade and was not named then does not fail the line.',
    `Lines that failed at the earlier grade:\n${
      failed.length === 0
        ? "None."
        : failed.map((line) => `- ${line.id}: ${line.gap}`).join("\n")
    }`,
    `Lines that passed at the earlier grade: ${passed.map((line) => line.id).join(", ") || "none"}.`,
  ].join("\n");
}

export function gradePrompt(input: GradePromptInput): string {
  const sections = [
    "You are the grader of one build pass. You can only read: files, text search, file names, and `git diff`, `git log` and `git show`. Judge the code that the builder wrote. Do not try to change anything.",
    `## Read the diff\n\nRun \`git diff ${input.base}\` to see the work of the build so far.`,
    `## Ticket\n\n${input.ticket.trim()}`,
    `## Stories this ticket delivers\n\n${input.stories.length === 0 ? "None." : input.stories.join("\n")}`,
    `## Decided cards\n\n${input.cards.length === 0 ? "None." : input.cards.map(cardSection).join("\n\n")}`,
    `## Lines to score\n\nScore every line, from 1 to 5. A 3 passes. A delivery line asks: does the diff meet this criterion? A contradiction line asks: does the diff do something this card forbids, or do it differently? A part of a card that the diff does not build yet passes its contradiction line, because another ticket builds it. The scope line fails when the diff builds a behaviour that no acceptance criterion and no story asks for; name each such behaviour in its gap.\n\n${lineList(input.specs)}`,
    `## Earlier grades\n\n${earlier(input.previous)}`,
    `## Reply\n\nEnd with one JSON object and nothing after it:\n\n\`\`\`json\n{"lines":[{"line":"criterion-1","score":4,"gap":"","builds":false,"person":false,"regression":false}]}\n\`\`\`\n\nEvery line above needs one entry. A line below 3 needs a gap: the unmet criterion or the contradiction, with the file, line or test that shows it. On a contradiction line, set "builds" to true when the diff builds that card. Set "person" to true when only a person can settle the gap.`,
  ];
  return `${sections.join("\n\n")}\n`;
}
