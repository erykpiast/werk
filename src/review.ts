/**
 * The quality review: five reviewers, one per area, in parallel. See #lp-prod-review.
 *
 * It runs after the grader passes, as the last gate of the builder loop (#st-build-ticket).
 * The grader asks whether the diff is the right change; a reviewer asks whether it is good
 * code. Each reviewer gets a fresh context and one area from the fixed rubric (REVIEW_AREAS),
 * so no area anchors on another's findings. A finding must point at the diff.
 *
 * CRITICAL or HIGH fails the pass, and the findings go into the next builder pass. MEDIUM and
 * LOW do not block: they are kept in the pass record, for the trend report (#lp-trend).
 */
import type { Failure, Gate } from './build.ts'
import { reviewerRole } from './instructions.ts'
import { diffFor, JUDGE_TOOLS } from './grade.ts'
import { parseFindings, reviewPrompt } from './review-parse.ts'
import { BLOCKING, REVIEW_AREAS } from './rubric.ts'

export { parseFindings, reviewPrompt, type Finding } from './review-parse.ts'

export const reviewers: Gate = async (ctx) => {
  const diff = await diffFor(ctx)
  const answers = await Promise.all(
    REVIEW_AREAS.map(async (area) => {
      const out = await ctx.session(`review-${area.key}-${ctx.pass}`, reviewPrompt(area, ctx.base, diff), JUDGE_TOOLS, { role: reviewerRole(area.key), onlyTools: true })
      // #st-build-silence-act: a silent reviewer is cancelled and counts as a failed step.
      if (out.silent) return { area: area.key, error: `cancelled for silence (${out.error})` }
      if (out.error) return { area: area.key, error: out.error }
      const findings = parseFindings(out.result ?? '', area.key)
      return typeof findings === 'string' ? { area: area.key, error: findings } : { area: area.key, findings }
    }),
  )
  const findings = answers.flatMap((a) => a.findings ?? [])
  const broken = answers.filter((a) => a.error)
  const blocking = findings.filter((f) => BLOCKING.includes(f.severity))
  const record = {
    review: findings,
    ...(broken.length ? { reviewErrors: broken.map((a) => ({ area: a.area, error: a.error })) } : {}),
  }
  let failure: Failure | undefined
  if (blocking.length) failure = { kind: 'review', findings: blocking }
  else if (broken.length) failure = { kind: 'step', step: `review (${broken.map((a) => a.area).join(', ')})`, detail: broken.map((a) => a.error).join('; ') }
  return { record, failure }
}
