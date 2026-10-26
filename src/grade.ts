/**
 * The grader: one agent reads the diff against the ticket's acceptance criteria (delivery
 * lines) and each decided card of the ticket's depends_on closure — the same set the builder
 * reads (contradiction lines). See #lp-prod-judge.
 *
 * It runs after green checks, as a gate of the builder loop (#st-build-ticket). Each line is a
 * score 1-5 and the gap: the unmet criterion or the contradiction. A score under
 * GRADE_PASS fails the pass, and the gaps go into the next builder pass's brief — a score with
 * no reason would give the builder nothing to fix. A card the grader leaves out is a fail too.
 */
import type { Failure, Gate, GateContext } from './build.ts'
import { criterionId, parseGrade, gradePrompt, SCOPE_LINE, UNRECORDED_LINE } from './grade-parse.ts'
import { runGit } from './prototype.ts'
import { GRADE_PASS } from './rubric.ts'

export { criterionId, deferrable, extractJson, gradePrompt, isCriterion, parseGrade, recordedCards, SCOPE_LINE, UNRECORDED_LINE, type GradeLine } from './grade-parse.ts'

/** The diff in a judge's prompt is cut to this many characters. The judge can read the rest. */
export const MAX_DIFF_CHARS = 60_000

/** Read-only, plus the git commands a judge needs to see the change. The list is the judge's
 *  whole tool set, and a judge cannot ask for more (#lp-prod-judge-read-only). */
export const JUDGE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)']

/** The diff from the base to the pass's commit, cut to MAX_DIFF_CHARS. */
export async function diffFor(ctx: Pick<GateContext, 'worktree' | 'base'>): Promise<string> {
  const diff = (await runGit(ctx.worktree, ['diff', ctx.base, 'HEAD'])).stdout
  if (diff.length <= MAX_DIFF_CHARS) return diff || '(empty diff)'
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n[... ${diff.length - MAX_DIFF_CHARS} characters cut: run \`git diff ${ctx.base} HEAD\` for the rest ...]`
}

export const grader: Gate = async (ctx) => {
  const criteria = ctx.ticket.acceptance
  if (ctx.judged.length === 0 && criteria.length === 0 && !ctx.followed) return { record: { grade: [] } }
  const out = await ctx.session(`grade-${ctx.pass}`, gradePrompt(ctx.judged, criteria, ctx.base, await diffFor(ctx), ctx.stories, ctx.followed, ctx.earlier), JUDGE_TOOLS, { role: 'grader', onlyTools: true })
  // #st-build-silence-act: a silent grader is cancelled and counts as a failed step.
  if (out.silent) return { record: { grade: null }, failure: { kind: 'step', step: 'grader', detail: `cancelled for silence (${out.error})` } }
  if (out.error) return { record: { grade: null }, failure: { kind: 'step', step: 'grader', detail: out.error } }
  const lines = parseGrade(out.result ?? '', [...criteria.map((_, i) => criterionId(i)), SCOPE_LINE, ...(ctx.followed ? [UNRECORDED_LINE] : []), ...ctx.judged.map((n) => n.id)])
  if (typeof lines === 'string') return { record: { grade: null }, failure: { kind: 'step', step: 'grader', detail: lines } }
  const low = lines.filter((l) => l.score < GRADE_PASS)
  const failure: Failure | undefined = low.length ? { kind: 'grade', lines: low } : undefined
  return { record: { grade: lines }, failure }
}
