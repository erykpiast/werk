/**
 * The pure half of the grader: its prompt, and how its answer is read. Split from grade.ts so
 * the 90% line gate can hold it without holding git — see #werk-test-scope-src0-pure-scope.
 * extractJson is shared by every judge that answers in JSON: the binder, the reviewers, and
 * the overseer's classifiers.
 */
import { GRADE_PASS } from './rubric.ts'
import type { GraphNode } from './types.ts'

/** `person`: the gap is a question only a person can settle, which counts as a spec gap
 *  (#st-build-cap-spec-gap). */
export type GradeLine = { card: string; score: number; gap: string; person?: true }

/** The JSON value in an agent's answer: a fenced json block, or the outermost array. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  const candidates = [fenced?.[1], text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)]
  for (const c of candidates) {
    if (!c || !c.trim()) continue
    try {
      return JSON.parse(c)
    } catch {
      // Try the next form.
    }
  }
  return undefined
}

/** The line id of the ticket's acceptance criterion `i` (0-based). No card id has this shape. */
export const criterionId = (i: number) => `criterion-${i + 1}`
export const isCriterion = (id: string) => /^criterion-\d+$/.test(id)

/** The id of the one scope line per ticket (#lp-prod-judge-scope). No card has this id. */
export const SCOPE_LINE = 'scope-line'

/** The id of the line that checks a "no new decision" record against the diff (#st-build-card).
 *  It exists only when the build recorded one. No card has this id. */
export const UNRECORDED_LINE = 'unrecorded-decision'

/** #lp-prod-judge: a delivery line per acceptance criterion, and a contradiction line per
 *  decided card of the closure. A ticket is one slice, so a card part it does not build passes.
 *  #lp-prod-judge-scope: one scope line, for a diff that builds what the ticket does not ask for.
 *  #st-grade-converge: `earlier` is the last failed grade of this build. The grader then checks
 *  those gaps and regressions only, so a ticket is not failed for a new detail on every pass. */
export function gradePrompt(cards: GraphNode[], criteria: string[], base: string, diff: string, stories: string[] = [], followed?: GraphNode[], earlier?: GradeLine[]): string {
  const record = followed
    ? `\n4. The line "${UNRECORDED_LINE}" checks the builder's record "no new decision". The builder says every choice in the diff came from the cards under "Cards the builder named" below. A card marked "proposed" is one that this build wrote and the person has not yet accepted: a choice it gives is recorded, so it never fails this line. Answer: does the diff make a choice that none of those cards gives, such as a name, a boundary, a data shape, an address or a trade-off? Name each such choice in the gap, so the next pass proposes a card for it. A list of values, a configuration, or the inside of one helper is not a decision, so it never fails this line.\n`
    : ''
  const converge = earlier
    ? `\n\n## The earlier grade of this ticket\n\nAn earlier pass of this ticket was graded, and these lines failed:\n\n${
        earlier.filter((l) => l.score < GRADE_PASS).map((l) => `- ${l.card} (score ${l.score}): ${l.gap}`).join('\n') || '(none)'
      }\n\nThis grade checks those gaps, not a fresh reading. Fail a line that failed before only if its gap is still open. Fail a line that passed before only for a regression: something that worked at the earlier grade and the diff since then broke. Do not fail a line that passed before for a gap that was already there.`
    : `\n\nName every gap you find on a line in this one answer, not only the first. A later grade of this ticket checks only the gaps you name now, plus regressions.`
  return `You are the grader in a build loop. You run headless: you may not ask a question.

This ticket is one slice of a larger piece of work. Other tickets build the rest. Read the diff below and score ${followed ? 'four' : 'three'} kinds of line. Code quality is another reviewer's job.

1. Each acceptance criterion of the ticket is a delivery line. Answer: does the diff meet this criterion?
2. Each decided card is a contradiction line. Answer: does the diff do something this card forbids, or do it differently from what the card says? First set "built": true when the diff builds any part of this card, false when it builds none of it. A part of the card that the diff does not build is never a gap: another ticket builds it, so it passes. "Not implemented" is not a contradiction.
3. The line "${SCOPE_LINE}" is the scope line. Answer: does the diff build a behaviour that no acceptance criterion and no user story of the ticket asks for? Name each such behaviour in the gap, so the next pass removes it.${record}

Score each line 1-5. A ${GRADE_PASS} passes. For each line also write the gap: the unmet criterion, the contradiction, or the behaviour out of scope, with the file, line, or test that shows it. On a pass, the gap may be empty. The next builder pass reads your gaps, so make each one something it can fix.${converge}

Some gaps no code can close: the ticket asks for what a decided card forbids, or neither the ticket nor the cards say what to build. Only a person can settle such a gap. Set "person": true on a failing line whose gap is one of these, and say in the gap what the person must decide. Leave it out on every other line.

The change is \`git diff ${base} HEAD\` in this checkout. You may read files and run git diff, git log and git show.

Answer with only a JSON array, one object per line, every criterion, the scope line${followed ? `, the "${UNRECORDED_LINE}" line` : ''} and every card below included. "card" is the criterion id, "${SCOPE_LINE}", ${followed ? `"${UNRECORDED_LINE}", ` : ''}or the card id. "built" goes on a card line only:

[{"card": "<criterion id, ${SCOPE_LINE}, ${followed ? `${UNRECORDED_LINE}, ` : ''}or card id>", "score": <1-5>, "built": <true or false, card lines only>, "gap": "<the gap, or empty>", "person": <true, only when a person must settle the gap>}]

## Acceptance criteria

${criteria.map((c, i) => `- ${criterionId(i)}: ${c}`).join('\n') || '(none)'}

## User stories the ticket delivers

${stories.join('\n') || '(none)'}

## Decided cards

${cards.map((n) => [`### #${n.id} — ${n.title}`, n.why ? `why: ${n.why}` : '', n.body ?? ''].filter(Boolean).join('\n')).join('\n\n')}
${followed ? `\n## Cards the builder named\n\n${followed.map((n) => [`### #${n.id} — ${n.title}${n.proposed ? ' (proposed)' : ''}`, n.why ? `why: ${n.why}` : '', n.body ?? ''].filter(Boolean).join('\n')).join('\n\n') || '(none: the record names no decided card)'}\n` : ''}
## Diff

\`\`\`diff
${diff}
\`\`\``
}

/** #st-build-card-proposed-recorded: the cards that the "no new decision" record covers. It is the
 *  decided cards the record names, and every card this build proposed, accepted or not. Undefined
 *  while the build has no record. */
export function recordedCards(followed: GraphNode[] | undefined, proposed: GraphNode[]): GraphNode[] | undefined {
  if (!followed) return undefined
  const seen = new Set(followed.map((n) => n.id))
  return [...followed, ...proposed.filter((n) => n.proposed && !seen.has(n.id))]
}

/** #st-grade-defer: failed lines that may merge on the last pass and go to a follow-up. Each is
 *  a card the diff builds with a small gap: one point under a pass, no person needed. An unmet
 *  criterion, the scope line, the record line and a plain contradiction still fail. */
export function deferrable(failed: GradeLine[]): boolean {
  return failed.length > 0 && failed.every((l) => !isCriterion(l.card) && l.card !== SCOPE_LINE && l.card !== UNRECORDED_LINE && !l.person && l.score === GRADE_PASS - 1)
}

/** The grade lines for `cardIds`, or why the answer is unreadable. A missing card scores 0.
 *  A card line the grader marks `built: false` passes: a diff cannot contradict a card it does
 *  not build, and a low score there would push the builder past its ticket (#lp-prod-judge). */
export function parseGrade(text: string, cardIds: string[]): GradeLine[] | string {
  const raw = extractJson(text)
  if (!Array.isArray(raw)) return 'the grader did not answer with a JSON array'
  const byCard = new Map<string, GradeLine>()
  for (const x of raw) {
    if (typeof x?.card !== 'string' || typeof x?.score !== 'number') continue
    const card = x.card.replace(/^#/, '')
    const unbuilt = x.built === false && !isCriterion(card) && card !== SCOPE_LINE && card !== UNRECORDED_LINE
    const person = x.person === true && x.score < GRADE_PASS ? { person: true as const } : {}
    byCard.set(card, unbuilt ? { card, score: Math.max(x.score, GRADE_PASS), gap: '' } : { card, score: x.score, gap: typeof x.gap === 'string' ? x.gap : '', ...person })
  }
  return cardIds.map((id) => byCard.get(id) ?? { card: id, score: 0, gap: 'the grader gave no line for this card' })
}
