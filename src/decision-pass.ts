/**
 * The decision pass: what a builder does when a ticket hits a decision no card makes. See
 * #st-build-missing-decision.
 *
 * Pure: the trigger reads two failures and a named cause, the proposals are read off the
 * graph's card obligations (#st-build-card), and the follow-up is ticket text.
 */
import type { Failure, NamedCause } from './build-prompt.ts'
import type { Graph, GraphNode } from './types.ts'

const SEVERE = new Set(['HIGH', 'CRITICAL'])

/** What one failure raised: the areas of its severe review findings, or the cards the grader
 *  scored low. Every finding counts when none is severe. Empty for any other gate. */
export function raisedBy(f: Failure | undefined): string[] {
  if (f?.kind === 'review') {
    const severe = f.findings.filter((x) => SEVERE.has(x.severity.toUpperCase()))
    return [...new Set((severe.length ? severe : f.findings).map((x) => `${x.area} findings`))]
  }
  if (f?.kind === 'grade') return [...new Set(f.lines.map((l) => `#${l.card}`))]
  return []
}

/** The grader lines of a failure whose gap only a person can settle. A failure with one ends
 *  on a spec gap, with no next pass needed to name it (#st-build-cap-spec-gap). */
export function personGaps(f: Failure | undefined): string[] {
  return f?.kind === 'grade' ? f.lines.filter((l) => l.person).map((l) => l.gap) : []
}

/**
 * Why the next pass must be a decision pass, or undefined when it need not be. Three signs: the
 * pass that just ran named the cause of the failure before it a spec gap, the grader said a
 * person must settle a gap of the last failure, or the last two passes failed at the same gate
 * on the same thing.
 */
export function decisionTrigger(o: { before?: Failure; last?: Failure; named?: { cause: NamedCause; why: string } }): string | undefined {
  if (o.named?.cause === 'spec-gap') return `a pass named a spec gap as the cause of a failure: ${o.named.why || 'no reason given'}`
  const person = personGaps(o.last)
  if (person.length) return `the grader said a person must settle: ${person.join('; ') || 'no gap given'}`
  if (!o.before || !o.last || o.before.kind !== o.last.kind) return undefined
  const again = raisedBy(o.last).filter((x) => raisedBy(o.before).includes(x))
  if (again.length === 0) return undefined
  const gate = o.last.kind === 'review' ? 'the reviewers' : 'the grader'
  return `${gate} raised ${again.join(', ')} in two passes in a row`
}

/** A ticket whose "What to build" starts with this mark makes its first pass a decision pass: the
 *  ticket exists to judge a question, such as a held-out step against a card
 *  (#st-heldout-step-contradiction). */
export const DECISION_MARK = 'Decision pass:'

/** Why the first pass is a decision pass, when the ticket says so. */
export function firstDecision(whatToBuild: string): string | undefined {
  const line = whatToBuild.trim().split('\n')[0]
  return line.startsWith(DECISION_MARK) ? line.slice(DECISION_MARK.length).trim() : undefined
}

/** The cards the builds of one ticket proposed, ghost or accepted, in the order they came. */
export function proposalsOf(g: Graph, ticket: string): GraphNode[] {
  const ids = [...g.obligations.values()].filter((o) => o.ticket === ticket).flatMap((o) => o.cards)
  return [...new Set(ids)].map((id) => g.nodes.get(id)).filter((n): n is GraphNode => n?.kind === 'card')
}

/** The ticket that reworks a merged ticket after a card it was built on changed. */
export function decisionFollowUpText(o: { of: string; changes: string[]; cites: string[]; checks: string[]; touches?: string[] }): string {
  return `title: Rework ${o.of} for a decision that changed after it merged
cites: ${o.cites.join(', ')}
blocked_by:
stories:
touches: ${(o.touches ?? []).join(', ')}

## What to build

${o.of} merged on a decision that a builder proposed, and the person has since ruled on it differently. Change the merged code so it follows each card as the map holds it now. A discarded card is no rule any more: remove what was built only for it, unless a cited card still needs it.

${o.changes.map((c) => `- ${c}`).join('\n')}

## Acceptance criteria

${o.changes.map((c) => `- [ ] The code follows the map after: ${c}`).join('\n')}

## Checks

${o.checks.map((c) => `- \`${c}\``).join('\n')}
`
}
