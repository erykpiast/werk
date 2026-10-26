/**
 * The pure half of the builder loop: what a builder pass is told. Split from build.ts so the
 * 90% line gate can hold it without holding git and the agents — see
 * #werk-test-scope-src0-pure-scope.
 */
import { isCriterion, SCOPE_LINE, UNRECORDED_LINE } from './grade-parse.ts'
import { NO_QUESTIONS, renderCards } from './loop-prompt.ts'
import { section } from './ticket.ts'
import type { ParsedTicket } from './ticket.ts'
import type { Graph, GraphNode } from './types.ts'

/** Why a pass did not go green. The next pass gets it in its brief. */
export type Failure =
  | { kind: 'silence'; detail: string }
  | { kind: 'check'; cmd: string; code: number; tail: string }
  | { kind: 'grade'; lines: Array<{ card: string; score: number; gap: string; person?: true }> }
  | { kind: 'review'; findings: Array<{ area: string; severity: string; file?: string; line?: number; impact: string; fix?: string }> }
  /** A grader or reviewer that went silent, failed, or answered in no readable form. */
  | { kind: 'step'; step: string; detail: string }
  /** The progress classifier said the pass was looping (#lp-overseer-progress). */
  | { kind: 'looping'; reason: string }
  /** The build process died mid-pass, and the server started the build again (#st-build-died). */
  | { kind: 'died'; detail: string }
  /** Green alone, red on the main line plus the ticket (#st-build-run). `conflict`: git could
   *  not merge it at all. `resolving`: the pass starts on the ticket's own branch with the tip
   *  merged in, and these are the files git left conflicted, maybe none
   *  (#st-build-conflict-resolve). Without it, the pass starts fresh from the tip. */
  | { kind: 'merge'; cmd: string; code: number; tail: string; conflict?: boolean; resolving?: string[] }

/** Which gate failed a pass, with what the report groups it by — #ms-fail. */
export type GateDetail =
  | { gate: 'check' | 'merge'; name: string }
  | { gate: 'grader'; cards: string[] }
  | { gate: 'review'; findings: Array<{ area: string; severity: string }> }
  | { gate: 'step'; name: string }
  | { gate: 'looping' | 'silence' | 'died' }

export function gateOf(f: Failure): GateDetail {
  switch (f.kind) {
    case 'check':
    case 'merge':
      return { gate: f.kind, name: f.cmd }
    case 'grade':
      return { gate: 'grader', cards: f.lines.map((l) => l.card) }
    case 'review':
      return { gate: 'review', findings: f.findings.map((x) => ({ area: x.area, severity: x.severity })) }
    case 'step':
      return { gate: 'step', name: f.step }
    case 'looping':
    case 'silence':
    case 'died':
      return { gate: f.kind }
  }
}

/** The causes the next pass may name (#ms-fail-cause). Flaky check comes from a rerun, check
 *  infra from the check run itself, and unknown from a fail with no next pass, so none of
 *  them is the builder's to name. */
export const NAMED_CAUSES = ['builder-error', 'spec-gap', 'false-finding', 'test-wrong', 'conflict'] as const
export type NamedCause = (typeof NAMED_CAUSES)[number]
export type Cause = NamedCause | 'flaky-check' | 'check-infra' | 'unknown'

const CAUSE_LINE = 'CAUSE OF THE LAST FAILURE:'

/** The cause the builder named on the last line of its answer that carries one. */
export function parseCause(text: string | undefined): { cause: NamedCause; why: string } | undefined {
  const lines = (text ?? '').split('\n').filter((l) => l.toUpperCase().includes(CAUSE_LINE))
  const line = lines.at(-1)
  if (!line) return undefined
  const rest = line.slice(line.toUpperCase().indexOf(CAUSE_LINE) + CAUSE_LINE.length).trim()
  const cause = NAMED_CAUSES.find((c) => rest.toLowerCase().startsWith(c))
  if (!cause) return undefined
  return { cause, why: rest.slice(cause.length).replace(/^[\s—–:-]+/, '').trim() }
}

/** Only a gate that judged the code has a cause to name. A stall, a loop, or a broken grader
 *  says nothing about the code. */
export const asksCause = (f: Failure): boolean => f.kind === 'check' || f.kind === 'grade' || f.kind === 'review' || f.kind === 'merge'

function causeAsk(f: Failure): string {
  return `## Cause of the last failure

When your work is done, end your final answer with one line in this form:

    ${CAUSE_LINE} <cause> — <one sentence why>

<cause> is one of:
- builder-error: an earlier pass got the code wrong, and the ticket and cards were clear enough to get it right
- spec-gap: the ticket or the cards were wrong, silent, or ambiguous on the point that failed
- false-finding: the failure named something that is not wrong; you changed nothing for it
${f.kind === 'check' || f.kind === 'merge' ? '- test-wrong: the test asserts old or wrong behaviour, the code was right, and you fixed the test\n' : ''}${f.kind === 'merge' ? '- conflict: the ticket clashes with work that merged after it was built\n' : ''}`
}

/** The spec lines of the stories a ticket delivers (#st-ticket-stories). */
export function storyLines(spec: string, numbers: number[]): string[] {
  return section(spec, 'User Stories')
    .split('\n')
    .filter((l) => {
      const n = l.match(/^\s*(\d+)\.\s/)?.[1]
      return n !== undefined && numbers.includes(Number(n))
    })
    .map((l) => l.trim())
}

/** The rejected options of the cited cards: what was weighed and why it lost. */
export function rejectedOf(g: Graph, ids: string[]): Array<{ card: string; title: string; whyNot?: string }> {
  return g.edges
    .filter((e) => e.type === 'alternative_to' && ids.includes(e.to))
    .map((e) => ({ card: e.to, node: g.nodes.get(e.from) }))
    .filter((x) => x.node?.kind === 'option')
    .map((x) => ({ card: x.card, title: x.node!.title, whyNot: x.node!.why_not }))
}

export function renderFailure(f: Failure | undefined): string {
  if (!f) return 'Nothing has failed yet.'
  switch (f.kind) {
    case 'silence':
      return `The last pass was cancelled by the overseer: ${f.detail}. A stall like that is not evidence that the ticket cannot be built. Its file changes were committed as they stood. Read the repository and carry on.`
    case 'check':
      return `The last check run failed. Command: \`${f.cmd}\` (exit ${f.code}). End of its output:\n\n\`\`\`\n${f.tail}\n\`\`\``
    case 'grade':
      return `The checks passed, but the grader found an unmet acceptance criterion, a contradiction with a decided card, or work the ticket does not ask for:\n\n${f.lines
        .map((l) => `- ${isCriterion(l.card) ? `acceptance ${l.card}` : l.card === SCOPE_LINE ? 'out of scope (remove it)' : l.card === UNRECORDED_LINE ? 'an unrecorded decision (propose a card for it)' : `#${l.card}`}, score ${l.score}/5: ${l.gap}`)
        .join('\n')}`
    case 'review':
      return `The checks and the grader passed, but the quality review found blocking issues:\n\n${f.findings
        .map((x) => `- ${x.severity} (${x.area}) ${x.file ?? ''}${x.line ? `:${x.line}` : ''} — ${x.impact}${x.fix ? ` Fix: ${x.fix}` : ''}`)
        .join('\n')}`
    case 'looping':
      return `The overseer stopped the last pass because it was looping: ${f.reason} Its file changes were committed as they stood. Do not repeat what it did; try a different approach.`
    case 'died':
      return `The last pass did not finish: ${f.detail}. Nothing is known to be wrong with its work, but the file changes it did not commit are gone. Read the repository and carry on.`
    case 'merge':
      if (f.conflict && f.resolving) {
        const files = f.resolving.length
          ? `Git left conflict markers in these files, and the merge is not committed yet:\n\n${f.resolving.map((p) => `- ${p}`).join('\n')}\n\nResolve every conflict so both sides keep working: the other ticket's change and this ticket's. Do not run \`git merge --abort\` or \`git reset\`.`
          : 'Git merged the tip in without a conflict this time, so only the checks are left to pass.'
        return `The ticket went green on its own branch, but git could not merge it onto the main line's current tip: another ticket changed the same code first. This pass starts on the ticket's own branch, with the main line's current tip merged into it, so the earlier work is still here. ${files} Command that failed in the merge queue: \`${f.cmd}\` (exit ${f.code}). End of its output:\n\n\`\`\`\n${f.tail}\n\`\`\``
      }
      if (f.conflict) {
        return `The ticket went green on its own branch, but git could not merge it onto the main line's current tip: another ticket changed the same code first. This pass starts fresh from that tip, so the earlier work is not in the repository. Build the ticket on top of what is there now. Command: \`${f.cmd}\` (exit ${f.code}). End of its output:\n\n\`\`\`\n${f.tail}\n\`\`\``
      }
      return `The ticket went green on its own branch, but the merge queue put it on top of the main line's current tip and a check failed there. Command: \`${f.cmd}\` (exit ${f.code}). End of its output:\n\n\`\`\`\n${f.tail}\n\`\`\``
    case 'step':
      return `The checks passed, but the ${f.step} step could not judge the change: ${f.detail}. Nothing in the code was found wrong. Make sure the change is complete and the checks still pass.`
  }
}

/** #st-build-missing-decision: the guideline and the commands of a decision pass. */
export function decisionSection(cli: string, obligation: string, why: string): string {
  return `## This is a decision pass

The loop made this pass a decision pass because ${why}. A failure that keeps coming back in a new form is usually a decision that no card above makes, not a bug. Fixing one more symptom will not end it.

1. Name the question no card answers, in one sentence. Read the failures above and the cited cards again before you write it. Then search the map for its terms (\`${cli} search "<term>"\`), at least twice with different words. If a decided card answers it, or already states a rule that implies the answer, build to that card and propose nothing. A card that only adds a detail to an existing rule is not needed.
2. List the answers you can see: two to four.
3. Pick one by this guideline, in order: the answer that is safest when it turns out wrong; deny by default; the least privilege that makes the ticket work; the smallest interface; no data deleted; the answer easiest to undo. When two answers are equal, pick the one that changes the fewest decided cards.
4. Propose it, with the person as the one who decides. The card is a proposal: the person accepts it or discards it later, and you never accept it yourself.

    ${cli} add <cited-card-id>-<short-slug> --title "<the answer, as a rule>" --why "<the question and why it matters>" --body "<the rule in full, and the guideline step that chose it>" --parent <the cited card it refines> --who you --obligation ${obligation}
    ${cli} add <that-id>:opt0 --kind option --title "<a rejected answer>" --why_not "<why the guideline rejected it>"
    ${cli} link <that-id>:opt0 <that-id> --type alternative_to
    ${cli} link <that-id> <card-it-needs> --type depends_on --why "what the new card takes from the card it needs"
    ${cli} kill <that-id> --form revisit --fallback <that-id>:opt0
    ${cli} status <that-id> decided

   Add one option for each rejected answer. The last command checks the card is complete and prints what is missing if it is not.
5. Then build the ticket to that rule, all of it, not only the last finding. The grader and the reviewers judge the ticket against the card you proposed.`
}

export function buildPrompt(p: {
  ticket: ParsedTicket
  stories: string[]
  cards: GraphNode[]
  rejected: Array<{ card: string; title: string; whyNot?: string }>
  /** Every decided card of the map, by id and title (#st-build-implement-search). */
  index?: Array<{ id: string; title: string }>
  checks: string[]
  pass: number
  cap: number
  base: string
  obligation: string
  lastFailure?: Failure
  /** The branch starts from an earlier build's work, not from the base. */
  resumed?: boolean
  /** Cards earlier builds of this ticket proposed: the ticket holds to them as if decided
   *  (#st-build-missing-decision). */
  proposed?: GraphNode[]
  /** Why this pass is a decision pass, when it is one (#st-build-missing-decision). */
  decision?: string
}): string {
  const t = p.ticket
  const history =
    p.pass === 1 && !p.resumed
      ? 'You are the first pass. Nothing has been done yet.'
      : `Earlier passes worked on this ticket. You do not have their conversation. The repository is the only memory: run \`git log --oneline ${p.base}..HEAD\` and \`git diff ${p.base} HEAD\` to see what they did.`
  // #werk-cli-name: the plain name, on the PATH of every agent werk starts.
  const cli = 'werk'
  // The pass runs the /implement skill — #st-build-implement. The skill's own tests and
  // review help the agent; the loop's checks, grader and review after the pass decide it.
  return `/implement the ticket below.

${NO_QUESTIONS}

You are pass ${p.pass} of at most ${p.cap} in a build loop. Each pass is a fresh agent. The loop commits anything you leave uncommitted when you exit. Then it runs the checks itself, and that run is the verdict. After green checks, a grader reads the diff against each cited card, and reviewers read it for quality.

${history}

Do not weaken, skip, or delete a test to make a check pass.

## Ticket: ${t.title}

### What to build

${t.whatToBuild}

### Acceptance criteria

${t.acceptance.map((a) => `- ${a}`).join('\n')}

### User stories it delivers

${p.stories.length ? p.stories.join('\n') : t.stories.length ? t.stories.map((n) => `Story ${n}`).join('\n') : 'None: this ticket delivers no user story (a prefactor, a refactor, or an internal fix).'}

## Decided cards this ticket depends on

${renderCards(p.cards)}
${p.proposed?.length ? `\n## Decisions earlier passes of this ticket proposed\n\nNo cited card made these, so an earlier pass decided them and proposed each as a card. The person rules on them later. Until then, hold to each as if it were decided, and so do the grader and the reviewers.\n\n${renderCards(p.proposed)}\n` : ''}
## Options that were weighed and rejected

${p.rejected.length ? p.rejected.map((r) => `- for #${r.card}: ${r.title}${r.whyNot ? ` — rejected because ${r.whyNot}` : ''}`).join('\n') : '(none)'}

## Checks

${p.checks.map((c) => `- \`${c}\``).join('\n')}

## The map

The cards above are the ones this ticket cites. The rest of the map holds other decided cards, and one of them may already answer a question this ticket raises. Here is every decided card, by id and title:

${p.index?.length ? p.index.map((n) => `- #${n.id} — ${n.title}`).join('\n') : '(none)'}

Before you decide anything that no card above gives — a name, a boundary, a data shape, an address, a trade-off — search the map for the terms of the question, and read every card that matches:

    ${cli} search "<term>" ["<term>" ...]
    ${cli} show <card-id>

A decided card that answers the question binds you the same as a cited card. Only when the search finds no answer, decide it yourself.

This build has a card obligation, \`${p.obligation}\`. Close it before you finish, in one of two ways.

A. Each time you make a decision that no card gives — not a cited card, and not a card your search found — propose it as a card at the moment you make it. One card for each decision.

Before each \`add\`, check that the card is new. Write its rule in one sentence. Search the map for the terms of that sentence and of your title, at least two searches with different words. Read every decided card that matches, and every proposed card of this ticket above. Then ask: does any of them already state this rule, or a rule that implies it? If one does, or if yours only adds a detail, a value, an exception, or a narrower case to that rule, do not propose a card. The code follows that card; name it in B. Propose only when the rule decides something that no existing card decides, and say in the \`--why\` which card is nearest and what it leaves open. Link that card with \`depends_on\` or refine it, and do not repeat its content.

    ${cli} add <cited-card-id>-<short-slug> --title "..." --why "..." --body "..." --parent <the cited card it refines> --who me --obligation ${p.obligation}
    ${cli} link <cited-card-id>-<short-slug> <card-it-needs> --type depends_on --why "what the new card takes from the card it needs"

B. When every choice in your diff came from a cited card or from a card your search found, you made no new decision. Record it, and name those cards. Never write a card only to close the obligation. A list of values, a configuration, or the inside of one helper is not a decision.

    ${cli} followed ${p.obligation} --cards <card-id>,<card-id>

The grader checks a record against your diff. A choice in the diff that none of the named cards gives fails the pass as an unrecorded decision.

WERK_LOG is already set, so the card or the record lands in the project's map, not in this worktree.
${p.decision ? `\n${decisionSection(cli, p.obligation, p.decision)}\n` : ''}
## Last failure

${renderFailure(p.lastFailure)}${p.lastFailure && asksCause(p.lastFailure) ? `\n\n${causeAsk(p.lastFailure)}` : ''}`
}
