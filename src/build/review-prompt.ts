/** The prompt of one reviewer: its one area, the diff to read, and the reply format (#lp-prod-review). Pure. */
import type { Area } from "./review.ts";

export function reviewPrompt(area: Area, base: string): string {
  const sections = [
    `You are the ${area.area} reviewer of one build pass. You can only read: files, text search, file names, and \`git diff\`, \`git log\` and \`git show\`. Do not try to change anything.`,
    `## Your area\n\n${area.area}: ${area.focus}.\n\nAsk whether the change is good code. Do not ask whether it is the right change; another agent judged that. Review only the diff and the code that the diff directly affects, not the whole repository. Report nothing outside your area.`,
    `## Read the diff\n\nRun \`git diff ${base}\` to see the work of the build so far.`,
    `## Reply\n\nEnd with one JSON object and nothing after it. Each finding has a severity (CRITICAL, HIGH, MEDIUM or LOW), a file, a line, the impact, and a fix. An empty list means no finding.\n\n\`\`\`json\n{"findings":[{"severity":"HIGH","file":"path/to/file","line":12,"impact":"what goes wrong","fix":"what to change"}]}\n\`\`\``,
  ];
  return `${sections.join("\n\n")}\n`;
}
