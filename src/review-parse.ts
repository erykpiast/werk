/**
 * The pure half of the quality review: a reviewer's prompt, and how its answer is read. Split
 * from review.ts so the 90% line gate can hold it — see #werk-test-scope-src0-pure-scope.
 */
import { extractJson } from './grade-parse.ts'
import { BLOCKING, REVIEW_AREAS, SEVERITIES } from './rubric.ts'
import type { Severity } from './rubric.ts'

export type Finding = { area: string; severity: Severity; file?: string; line?: number; impact: string; fix?: string }

type Area = (typeof REVIEW_AREAS)[number]

export function reviewPrompt(area: Area, base: string, diff: string): string {
  return `You are a code reviewer for one area: ${area.title}. You run headless: you may not ask a question.

Review only this area: ${area.ask}. Other reviewers cover the other areas, and a grader has already checked that the change does what was decided. Ask only whether the change is good code.

Review only the diff, and code that the diff directly affects. Do not review the rest of the repository. The change is \`git diff ${base} HEAD\` in this checkout; you may read files and run git diff, git log and git show.

For each finding give a severity (${SEVERITIES.join(', ')}), the file and line, the impact, and a fix. ${BLOCKING.join(' and ')} fail the build and send it back to the builder, so use them only for a real defect.

Answer with only a JSON array, empty when you find nothing:

[{"severity": "HIGH", "file": "<path>", "line": <n>, "impact": "<what goes wrong>", "fix": "<what to change>"}]

## Diff

\`\`\`diff
${diff}
\`\`\``
}

/** The findings of one reviewer, or why its answer is unreadable. */
export function parseFindings(text: string, area: string): Finding[] | string {
  const raw = extractJson(text)
  if (!Array.isArray(raw)) return 'the reviewer did not answer with a JSON array'
  return raw
    .filter((x) => typeof x?.impact === 'string')
    .map((x) => {
      const sev = String(x.severity ?? '').toUpperCase()
      return {
        area,
        // #lp-prod-review-unknown-severity: an unknown severity is recorded as written, or as
        // UNKNOWN when there is none. It never blocks: BLOCKING lists only CRITICAL and HIGH.
        severity: ((SEVERITIES as readonly string[]).includes(sev) ? sev : sev || 'UNKNOWN') as Severity,
        file: typeof x.file === 'string' ? x.file : undefined,
        line: typeof x.line === 'number' ? x.line : undefined,
        impact: x.impact,
        fix: typeof x.fix === 'string' ? x.fix : undefined,
      }
    })
}
