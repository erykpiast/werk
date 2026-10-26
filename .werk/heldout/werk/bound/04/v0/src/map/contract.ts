/**
 * The decide contract (#werk-contract): the facts a card needs before it is decided. The
 * check reads the folded map, never the text of a card. A pure module: no I/O.
 *
 * It runs at two state changes only: the move to decided, and an amend of a decided card
 * (#map-frozen). Creation and a reopen are not checked (#werk-contract-when).
 *
 * A real card reads its live edges only, so a ghost never counts toward it. A ghost reads its
 * held edges too (#werk-propose-new), so it can be proposed already decided, as one unit.
 */
import type { EventBody, LogEvent } from './events.ts'
import { allEdges, applyEvent, type Card, type Link, type MapState } from './fold.ts'

export type ContractFact = 'who' | 'basis' | 'options' | 'kill'

/** A missing fact: why it is missing, and the one command that supplies it (#werk-contract-fix). */
export type Missing = { fact: ContractFact; reason: string; fix: string }

/** The facts that card `id` misses in this state, in a fixed order: who, basis, options, kill. */
export function missingFacts(state: MapState, id: string): Missing[] {
  const card = state.cards[id]!
  const missing: Missing[] = []
  if (card.who === undefined) {
    missing.push({ fact: 'who', reason: `who decides #${id} is not recorded.`, fix: `werk edit ${id} --who <you|me|prototype>` })
  }
  const basis = basisProblem(state, id)
  if (basis) missing.push(basis)
  if (card.who === 'you' && card.unchallenged === undefined && options(state, id).length === 0) {
    missing.push({
      fact: 'options',
      reason: `#${id} is yours to decide, and no option weighed against it is recorded. A card with none records why with edit --unchallenged.`,
      fix: `werk add ${nextOptionId(state, id)} --kind option --title "<the alternative>" --why-not "<why it lost>" --alternative-to ${id}`,
    })
  }
  if (card.kill.length === 0) {
    missing.push({ fact: 'kill', reason: `#${id} has no kill criterion.`, fix: `werk kill ${id} "<what must become true to revisit this decision>"` })
  }
  return missing
}

/**
 * The basis fact: a depends_on target or the refines parent that is decided and not marked,
 * or a recorded reason that none applies. A card whose basis is open or marked waits on it
 * (#map-wait), and the fix decides that basis.
 */
function basisProblem(state: MapState, id: string): Missing | undefined {
  if (state.cards[id]!.noBasis !== undefined) return undefined
  const out = edgesOf(state, id).filter((l) => l.from === id)
  const parent = out.find((l) => l.type === 'refines')?.to
  const targets = [...(parent === undefined ? [] : [parent]), ...out.filter((l) => l.type === 'depends_on').map((l) => l.to)]
  const bases = targets.map((t) => state.cards[t]!).filter((c) => !c.removed)
  const marked = (c: Card) => c.stale.length > 0 || c.review.length > 0
  if (bases.some((c) => c.status === 'decided' && !marked(c))) return undefined
  const waiting = bases[0]
  if (waiting) {
    const why = bases.map((c) => `#${c.id} is ${c.status === 'decided' ? 'stale' : 'open'}`).join(', ')
    return { fact: 'basis', reason: `#${id} waits on its basis: ${why}.`, fix: `werk status ${waiting.id} decided` }
  }
  return {
    fact: 'basis',
    reason: `#${id} has no basis: no depends_on target and no decided parent. A card that needs none records why with edit --no-basis.`,
    fix: `werk link ${id} <card-it-needs> --type depends_on --why "<what #${id} takes from it>"`,
  }
}

/** The options linked alternative_to card `id` and not removed. */
function options(state: MapState, id: string): string[] {
  return edgesOf(state, id).filter((l) => l.to === id && l.type === 'alternative_to' && !state.cards[l.from]!.removed).map((l) => l.from)
}

/** The edges the check reads for card `id`: live ones, and held ones too for a ghost. */
function edgesOf(state: MapState, id: string): Link[] {
  return state.cards[id]!.proposed ? allEdges(state) : state.links
}

function nextOptionId(state: MapState, id: string): string {
  let n = 0
  while (state.cards[`${id}:opt${n}`]) n++
  return `${id}:opt${n}`
}

/**
 * The decided card that this event amends, if any, and whether the event changes a frozen
 * field (#map-frozen): the title, the text, a depends_on link or the parent. A record, a kill
 * criterion, another link from the card and the removal of its option are free changes.
 */
function amendOf(state: MapState, event: EventBody): { id: string; frozen: boolean } | undefined {
  const target =
    event.type === 'retitled' || event.type === 'edited'
      ? { id: event.id, frozen: true }
      : event.type === 'recorded'
        ? { id: event.id, frozen: false }
        : event.type === 'linked'
          ? { id: event.from, frozen: event.link === 'depends_on' || event.link === 'refines' }
          : event.type === 'removed'
            ? { id: allEdges(state).find((l) => l.from === event.id && l.type === 'alternative_to')?.to, frozen: false }
            : undefined
  return target?.id !== undefined && state.cards[target.id]?.status === 'decided' ? { id: target.id, frozen: target.frozen } : undefined
}

/**
 * The refusal of the contract for one event, or undefined when the event may be appended.
 * A change to a frozen field of a decided card needs every fact, so a card decided before a
 * fact was required waits on it. A free change is refused only when it removes a fact the
 * card had, so the commands that supply the missing facts always go through. An event that
 * breaks a rule of the fold is left to the fold's own check.
 */
export function contractCheck(state: MapState, event: EventBody): string | undefined {
  if (event.type === 'decided') {
    if (!state.cards[event.id]) return undefined
    return refusal(`#${event.id} cannot be decided:`, missingFacts(state, event.id))
  }
  const amend = amendOf(state, event)
  if (amend === undefined) return undefined
  const after = applyEvent(state, { ...event, seq: state.seq + 1, at: '' } as LogEvent)
  if (after.problems.length > state.problems.length) return undefined
  const before = new Set(missingFacts(state, amend.id).map((m) => m.fact))
  const missing = missingFacts(after, amend.id).filter((m) => amend.frozen || !before.has(m.fact))
  return refusal(`the change to #${amend.id} is refused: #${amend.id} is decided, and after it`, missing)
}

function refusal(head: string, missing: Missing[]): string | undefined {
  if (missing.length === 0) return undefined
  const count = missing.length === 1 ? '1 fact is missing' : `${missing.length} facts are missing`
  return [`${head} ${count}.`, ...missing.flatMap((m) => [`  ${m.reason}`, `    ${m.fix}`])].join('\n')
}
