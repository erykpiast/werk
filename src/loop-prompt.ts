/**
 * The pure half of the build loop: what each pass is told, and which decided cards it is
 * given. Split from loop.ts so the 90% line gate can hold it without holding the git and
 * child-process half — see #werk-test-scope-src0-pure-scope.
 */
import type { Graph, GraphNode } from './types.ts'

/** `output` is the whole output, for a file beside the pipeline log (#ms-store-files). */
export type CheckResult = {
  cmd: string
  ok: boolean
  code: number
  ms: number
  tail: string
  output?: string
  /** Set when the check could not judge the code: it did not start, timed out, or its
   *  command was missing. The words say which (#ms-fail-cause). */
  infra?: string
}

/** The last failure the next pass sees is cut to this many characters. */
export const FAILURE_CHARS = 4000

/** The end of a long output, where test runners and compilers put the summary. */
export function tail(text: string, max = FAILURE_CHARS): string {
  if (text.length <= max) return text
  return `[... ${text.length - max} characters cut ...]\n${text.slice(-max)}`
}

/** Every decided card reachable from `ids` over depends_on, the starting cards included.
 *  An open or proto card is not a decision, so it is left out, but the walk goes on past it. */
export function decidedClosure(g: Graph, ids: string[]): GraphNode[] {
  const out: GraphNode[] = []
  const seen = new Set<string>()
  const queue = [...ids]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const n = g.nodes.get(id)
    if (!n || n.kind !== 'card') continue
    if ((n.status ?? 'decided') === 'decided' && !g.stale.has(id)) out.push(n)
    for (const e of g.edges) if (e.type === 'depends_on' && e.from === id) queue.push(e.to)
  }
  return out
}

export function renderCards(cards: GraphNode[]): string {
  if (cards.length === 0) return '(none given)'
  return cards
    .map((n) => [`### #${n.id} — ${n.title}`, n.why ? `why: ${n.why}` : '', n.body ?? ''].filter(Boolean).join('\n'))
    .join('\n\n')
}

export const NO_QUESTIONS = `You run headless. You may not ask a question, and you may not use AskUserQuestion. If the brief leaves something open, pick a reasonable reading and say so in one short line at the end of your answer.`

export function freshPrompt(p: {
  brief: string
  cards: GraphNode[]
  checks: string[]
  pass: number
  cap: number
  base: string
  lastFailure?: CheckResult
}): string {
  const history =
    p.pass === 1
      ? 'You are the first pass. Nothing has been done yet.'
      : `Earlier passes worked on this ticket. You do not have their conversation. The repository is the only memory: run \`git log --oneline ${p.base}..HEAD\` and \`git diff ${p.base} HEAD\` to see what they did.`
  const failure = p.lastFailure
    ? `The last check run failed. Command: \`${p.lastFailure.cmd}\` (exit ${p.lastFailure.code}). End of its output:\n\n\`\`\`\n${p.lastFailure.tail}\n\`\`\``
    : 'No check has failed yet.'
  return `${NO_QUESTIONS}

You are pass ${p.pass} of at most ${p.cap} in a build loop. Each pass is a fresh agent. Do one unit of work that moves the ticket toward passing the checks, then stop. Do not commit: the loop commits your changes when you exit. Then it runs the checks itself, and that run is the verdict.

${history}

Do not weaken, skip, or delete a test to make a check pass.

## Ticket

${p.brief}

## Decided cards this ticket depends on

${renderCards(p.cards)}

## Checks

${p.checks.map((c) => `- \`${c}\``).join('\n')}

## Last failure

${failure}`
}
