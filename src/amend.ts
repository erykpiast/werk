// The four decide facts as a pure function of the map, and the check on a change to a card
// that is decided already. The CLI and the server's ✓ both run it — #werk-contract,
// #werk-contract-amend-scope.
import { killPrompt } from './kill.ts'
import type { EdgeType, Graph, GraphNode, Pending } from './types.ts'

/** A change that could take a fact from a decided card: the facts it sets, or a link it drops. */
export type Change = {
  patch?: Partial<Pick<GraphNode, 'who' | 'noBasis' | 'noAlternative'>>
  dropEdge?: { from: string; to: string; type: EdgeType }
}

/** The facts a proposal sets on a decided card, as a change. */
export function pendingChange(p: Pending | undefined): Change {
  return { patch: p?.facts ?? {} }
}

/**
 * The problems the four facts report for a card, as the card would be after `change`. The
 * decide runs it on the card as it is. A change to a decided card runs it on the card as it
 * would be, and compares — see `amendRefusal`.
 */
export function contractProblems(g: Graph, id: string, change: Change = {}): string[] {
  const node = { ...g.nodes.get(id)!, ...change.patch }
  const problems: string[] = []
  // A ghost's own edges are held, not live. The contract still has to see them, or a
  // card could only be proposed as open and would need a second turn to become decided.
  const held = node.proposed ? [...g.edges, ...g.ghostEdges] : g.edges
  const drop = change.dropEdge
  const visible = drop ? held.filter((e) => !(e.from === drop.from && e.to === drop.to && e.type === drop.type)) : held
  if (!node.who) {
    problems.push(`who is not set. Run:\n      werk edit ${id} --who you|me|prototype`)
  }
  const hasBasis = visible.some((e) => e.from === id && e.type === 'depends_on')
  if (!hasBasis && !node.noBasis) {
    problems.push(
      `no depends_on edge, and --no-basis is not on record. Run one of:\n` +
        `      werk link ${id} <parent-id> --type depends_on --why "..."\n` +
        `      werk edit ${id} --no-basis`,
    )
  }
  if (node.who === 'you') {
    const hasOption = visible.some((e) => e.to === id && e.type === 'alternative_to')
    if (!hasOption && !node.noAlternative) {
      problems.push(
        `who is "you", but no alternative_to option is linked, and --unchallenged is not on record. Run one of:\n` +
          `      werk add ${id}:opt0 --kind option --title "..." --why_not "..."\n` +
          `      werk link ${id}:opt0 ${id} --type alternative_to\n` +
          `      werk edit ${id} --unchallenged`,
      )
    }
  }
  if (!node.kill?.length) {
    const all = [...g.edges, ...g.ghostEdges]
    const options = [...g.nodes.values()]
      .filter((o) => all.some((e) => e.from === o.id && e.to === id && e.type === 'alternative_to'))
      .map((o) => ({ id: o.id, title: o.title }))
    problems.push(killPrompt(id, options))
  }
  return problems
}

/**
 * #werk-contract-amend-scope: a change to a decided card cannot leave it missing a fact.
 * `all`: the words, who, a waiver, a depends_on link or the parent change, so the card must
 * hold every fact after. Otherwise (the removal of an option): refused only for a fact the
 * card held before, so a card decided before a fact became required can still receive the
 * fact that is missing. Returns the refusal, or undefined when the change may go through.
 */
export function amendRefusal(g: Graph, id: string, change: Change, all: boolean): string | undefined {
  const node = g.nodes.get(id)
  if (!node || node.kind !== 'card' || node.status !== 'decided' || node.proposed) return undefined
  const before = all ? [] : contractProblems(g, id)
  const lost = contractProblems(g, id, change).filter((p) => !before.includes(p))
  if (lost.length === 0) return undefined
  return `this change would leave the decided card "${id}" missing a fact:\n  - ${lost.join('\n  - ')}`
}
