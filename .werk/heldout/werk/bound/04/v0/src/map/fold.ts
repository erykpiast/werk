/**
 * The fold: the log in, the map out (#pr-log). It reads the events from the top, and each
 * event changes the state that the events above it built. A pure module: no I/O.
 *
 * The state is plain JSON, so the server can send it to the client as it is.
 */
import { eventIds, FACTS, FIELDS, isNewNode, KINDS, LINK_TYPES, REOPEN_REASONS, WHOS, type EventBody, type Kind, type LinkType, type LogEvent, type NewNode, type ReopenReason, type Who } from './events.ts'
import { markPaused, markReview, markStale, resume, type Mark } from './marks.ts'

export type { Mark } from './marks.ts'

/** A verbatim excerpt on a card, attributed. */
export type Say = { who: string; text: string; seq: number }

/** The reopen that left a card open: its reason and why, at which event. */
export type Reopen = { reason: ReopenReason; why: string; seq: number; at: string }

export type Card = {
  id: string
  kind: Kind
  title: string
  why: string
  body: string
  whyNot: string
  status: 'open' | 'decided'
  /** The contract facts (#werk-contract-facts). Each is a record in the log, never a default. */
  who?: Who
  /** The written reason that the card needs no basis. */
  noBasis?: string
  /** The written reason that no option was weighed against the card (#werk-contract-guess). */
  unchallenged?: string
  /** The kill criteria, in the order they were recorded (#kill-ask). */
  kill: string[]
  /** The event that last decided the card. */
  decidedAt?: number
  removed: boolean
  says: Say[]
  /** The reopen that left the card open. A decide clears it. */
  reopen?: Reopen
  /** Marks from a change one hop away, over refines or depends_on. A decide clears them. */
  stale: Mark[]
  /** Marks from a postponed card upstream, at any distance. Deciding that card clears them. */
  paused: Mark[]
  /** Marks from a disputed source, over supported_by. Never stale. A decide clears them. */
  review: Mark[]
  /**
   * A ghost (#werk-propose-new): proposed and not accepted yet. It is drawn, and it is
   * outside every derivation: no live edge, no mark, no count. An accept drops the flag.
   */
  proposed?: true
}

export type Link = { from: string; to: string; type: LinkType; why: string; seq: number }

/** An event the fold refused, with the reason. The event stays in the log. */
export type Problem = { seq: number; message: string }

export type MapState = {
  cards: Record<string, Card>
  /** The live edges: both ends are real. Every derivation reads these only. */
  links: Link[]
  /**
   * The held edges: a ghost at one end or both. They are drawn on the ghost and feed its
   * decide check. An edge goes live by itself once both ends are real.
   */
  ghostEdges: Link[]
  problems: Problem[]
  /** The seq of the last event folded, 0 for an empty log. */
  seq: number
}

export function emptyMap(): MapState {
  return { cards: {}, links: [], ghostEdges: [], problems: [], seq: 0 }
}

export function fold(events: readonly LogEvent[]): MapState {
  return events.reduce(applyEvent, emptyMap())
}

/**
 * Applies one event. An event that breaks a rule of the map is not applied: it goes into
 * `problems`, so one bad line does not hide the rest of the map.
 */
export function applyEvent(state: MapState, event: LogEvent): MapState {
  const problem = check(state, event)
  if (problem) return { ...state, problems: [...state.problems, { seq: event.seq, message: problem }], seq: event.seq }
  const next: MapState = { cards: { ...state.cards }, links: state.links, ghostEdges: state.ghostEdges, problems: state.problems, seq: event.seq }
  const update = (id: string, change: Partial<Card>) => {
    next.cards[id] = { ...next.cards[id]!, ...change }
  }
  switch (event.type) {
    case 'added':
    case 'proposed':
      next.cards[event.id] = newCard(event)
      if (event.parent !== undefined) addEdge(next, { from: event.id, to: event.parent, type: 'refines', why: '', seq: event.seq })
      if (event.alternativeTo !== undefined) addEdge(next, { from: event.id, to: event.alternativeTo, type: 'alternative_to', why: '', seq: event.seq })
      break
    case 'linked':
      addEdge(next, { from: event.from, to: event.to, type: event.link, why: event.why ?? '', seq: event.seq })
      break
    case 'accepted':
      for (const id of acceptedWith(state, event.id)) {
        const card = { ...next.cards[id]! }
        delete card.proposed
        next.cards[id] = card
      }
      // The held edges whose ends are now both real go live in the same event.
      next.links = [...state.links, ...state.ghostEdges.filter((l) => isReal(next, l))].sort((a, b) => a.seq - b.seq)
      next.ghostEdges = state.ghostEdges.filter((l) => !isReal(next, l))
      break
    case 'discarded': {
      const dropped = new Set(discardedWith(state, event.id))
      for (const id of dropped) delete next.cards[id]
      next.ghostEdges = state.ghostEdges.filter((l) => !dropped.has(l.from) && !dropped.has(l.to))
      break
    }
    case 'retitled':
      update(event.id, { title: event.title })
      markStale(next.cards, next.links, { id: event.id, seq: event.seq, at: event.at, change: 'retitled' })
      break
    case 'edited':
      update(event.id, { [event.field]: event.text })
      markStale(next.cards, next.links, { id: event.id, seq: event.seq, at: event.at, change: 'edited' })
      break
    case 'decided': {
      // A decide reviews the card: its own marks go. A decide of a postponed card resumes its work.
      const { reopen: _, ...card } = next.cards[event.id]!
      next.cards[event.id] = { ...card, status: 'decided', decidedAt: event.seq, stale: [], review: [] }
      resume(next.cards, event.id)
      break
    }
    case 'recorded':
      update(event.id, { [event.fact]: event.value })
      break
    case 'killAdded':
      update(event.id, { kill: [...state.cards[event.id]!.kill, event.text] })
      break
    case 'reopened': {
      update(event.id, { status: 'open', reopen: { reason: event.reason, why: event.why, seq: event.seq, at: event.at } })
      const change = { id: event.id, seq: event.seq, at: event.at, change: 'reopened', reason: event.reason, why: event.why } as const
      if (event.reason === 'postponed') markPaused(next.cards, next.links, change)
      else markStale(next.cards, next.links, change)
      break
    }
    case 'removed':
      update(event.id, { removed: true })
      break
    case 'restored':
      update(event.id, { removed: false })
      break
    case 'said':
      update(event.id, { says: [...state.cards[event.id]!.says, { who: event.who, text: event.text, seq: event.seq }] })
      break
    case 'disputed':
      markReview(next.cards, next.links, { id: event.id, seq: event.seq, at: event.at, change: 'disputed', why: event.why })
      break
  }
  return next
}

function newCard(event: NewNode & { type: 'added' | 'proposed' }): Card {
  const card: Card = {
    id: event.id,
    kind: event.kind,
    title: event.title,
    why: event.why ?? '',
    body: event.body ?? '',
    whyNot: event.whyNot ?? '',
    status: 'open',
    kill: [],
    removed: false,
    says: [],
    stale: [],
    paused: [],
    review: [],
  }
  if (event.who !== undefined) card.who = event.who
  if (event.type === 'proposed') card.proposed = true
  return card
}

const isGhost = (state: MapState, id: string) => state.cards[id]?.proposed === true
const isReal = (state: MapState, link: Link) => !isGhost(state, link.from) && !isGhost(state, link.to)

/** An edge with a ghost at either end is held; an edge between two real nodes is live. */
function addEdge(state: MapState, link: Link): void {
  if (isReal(state, link)) state.links = [...state.links, link]
  else state.ghostEdges = [...state.ghostEdges, link]
}

/** Every edge, live and held. The view draws them all; a derivation reads `links` only. */
export function allEdges(state: MapState): Link[] {
  return [...state.links, ...state.ghostEdges]
}

/**
 * The ghosts one accept makes real: the ghost itself, its ghost refines parents up to the
 * first real one, so a click cannot orphan a card, and its own ghost options and evidence.
 * A depends_on target is never among them: it is a different card, with its own words.
 */
export function acceptedWith(state: MapState, id: string): string[] {
  const ids = [id]
  for (let parent = parentOf(state, id); parent !== undefined && isGhost(state, parent) && !ids.includes(parent); parent = parentOf(state, parent)) {
    ids.push(parent)
  }
  for (const link of state.ghostEdges) {
    if (link.to === id && link.type === 'alternative_to' && isGhost(state, link.from)) ids.push(link.from)
    if (link.from === id && link.type === 'supported_by' && isGhost(state, link.to)) ids.push(link.to)
  }
  return ids
}

/**
 * The ghosts one discard drops: the ghost and every ghost below it, over refines, with the
 * ghost options weighed against any of them. No ghost hangs under a card that is gone.
 */
export function discardedWith(state: MapState, id: string): string[] {
  const ids = [id]
  for (let i = 0; i < ids.length; i++) {
    for (const link of state.ghostEdges) {
      const below = link.to === ids[i] && (link.type === 'refines' || link.type === 'alternative_to')
      if (below && isGhost(state, link.from) && !ids.includes(link.from)) ids.push(link.from)
    }
  }
  return ids
}

/** The reason an event cannot apply to this state, or undefined when it can. */
export function check(state: MapState, event: EventBody): string | undefined {
  if (isNewNode(event)) {
    if (!event.id) return 'a card needs an id'
    if (isGhost(state, event.id)) return frozen(event.id)
    if (state.cards[event.id]) return `#${event.id} already exists`
    if (!KINDS.includes(event.kind)) return `unknown kind: ${event.kind}`
    if (!event.title) return `#${event.id} needs a title`
    if (event.who !== undefined && !WHOS.includes(event.who)) return `unknown who: ${event.who}`
    if (event.parent !== undefined && event.alternativeTo !== undefined) return `#${event.id} cannot both refine a card and be an alternative_to one`
    const to = event.parent ?? event.alternativeTo
    if (to === undefined) return undefined
    if (!state.cards[to]) return `no card #${to}`
    // The new card is not in the state yet, so check its link against a state that has it.
    const placed: MapState = { ...state, cards: { ...state.cards, [event.id]: newCard(event) } }
    return checkLink(placed, event.id, to, event.parent !== undefined ? 'refines' : 'alternative_to')
  }
  for (const id of eventIds(event)) {
    if (id === undefined) return `unknown event type: ${event.type}`
    if (!state.cards[id]) return `no card #${id}`
  }
  switch (event.type) {
    case 'linked':
      return checkLink(state, event.from, event.to, event.link)
    case 'accepted':
    case 'discarded':
      return isGhost(state, event.id) ? undefined : `#${event.id} is not a proposal`
    case 'retitled':
      if (isGhost(state, event.id)) return frozen(event.id)
      return event.title ? undefined : `#${event.id} needs a title`
    case 'edited':
      if (isGhost(state, event.id)) return frozen(event.id)
      return FIELDS.includes(event.field) ? undefined : `unknown field: ${event.field}`
    case 'decided': {
      // A decided card with marks may be decided again: that clears the marks.
      const card = state.cards[event.id]!
      return card.status === 'decided' && card.stale.length === 0 && card.review.length === 0 ? `#${event.id} is already decided` : undefined
    }
    case 'recorded':
      if (!FACTS.includes(event.fact)) return `unknown fact: ${event.fact}`
      if (!event.value) return `#${event.id}: a record of ${event.fact} needs a value`
      return event.fact === 'who' && !WHOS.includes(event.value as Who) ? `who is one of ${WHOS.join(', ')}, got ${event.value}` : undefined
    case 'killAdded':
      return event.text ? undefined : `#${event.id}: a kill criterion needs its text`
    case 'reopened':
      if (!REOPEN_REASONS.includes(event.reason)) return `a reopen needs a reason: ${REOPEN_REASONS.join(' or ')}`
      return state.cards[event.id]!.status === 'decided' ? undefined : `#${event.id} is not decided`
    case 'removed':
    case 'restored':
      if (isGhost(state, event.id)) return `#${event.id} is a proposal: discard it, it is not in the map to remove`
      if (event.type === 'restored') return state.cards[event.id]!.removed ? undefined : `#${event.id} is not removed`
      return state.cards[event.id]!.removed ? `#${event.id} is already removed` : undefined
    case 'said':
      return event.text && event.who ? undefined : 'an excerpt needs its text and who said it'
    case 'disputed':
      return state.cards[event.id]!.kind === 'source' ? undefined : `#${event.id} is not a source`
    default:
      return `unknown event type: ${(event as { type: string }).type}`
  }
}

/** The words of a ghost are frozen (#werk-propose-new): what the person reads is what an accept commits. */
function frozen(id: string): string {
  return `#${id} is a proposal, and its words are frozen. To change them, discard it and propose it again.`
}

/** A link is checked against every edge, held ones too, so an accept can never break a rule. */
function checkLink(state: MapState, from: string, to: string, type: LinkType): string | undefined {
  if (!LINK_TYPES.includes(type)) return `unknown link type: ${type}`
  if (from === to) return `#${from} cannot link to itself`
  const source = state.cards[from]!
  const target = state.cards[to]!
  const edges = allEdges(state)
  if (edges.some((l) => l.from === from && l.to === to && l.type === type)) return `#${from} already ${type} #${to}`
  if (source.kind === 'option' && type !== 'alternative_to') return `an option has one link only: alternative_to, not ${type}`
  if (source.kind === 'option' && edges.some((l) => l.from === from)) return `option #${from} already has its alternative_to link`
  if (type === 'alternative_to' && source.kind !== 'option') return `only an option can be an alternative_to a card`
  if (type === 'alternative_to' && target.kind !== 'card') return `an option is an alternative_to a card, and #${to} is a ${target.kind}`
  if (type === 'supported_by' && target.kind !== 'source' && target.kind !== 'excerpt') return `supported_by points at a source or an excerpt, and #${to} is a ${target.kind}`
  if (target.kind === 'option') return `an option has one link only, so #${to} cannot be the target of ${type}`
  if (type === 'refines') {
    if (edges.some((l) => l.from === from && l.type === 'refines')) return `#${from} already refines a parent`
    if (ancestors(state, to).includes(from)) return `#${from} refines #${to} would make a cycle`
  }
  return undefined
}

/** The refines parent of a card, if it has one: live, or held for a ghost at either end. */
export function parentOf(state: MapState, id: string): string | undefined {
  return allEdges(state).find((l) => l.from === id && l.type === 'refines')?.to
}

/** The chain of refines parents, nearest first. */
export function ancestors(state: MapState, id: string): string[] {
  const chain: string[] = []
  for (let parent = parentOf(state, id); parent !== undefined && !chain.includes(parent); parent = parentOf(state, parent)) {
    chain.push(parent)
  }
  return chain
}

/**
 * What changed after a card was last decided (#pr-log): the events after that decide that
 * touch the card itself or a card it depends_on. Empty for a card that was never decided.
 */
export function changesSinceDecided(events: readonly LogEvent[], id: string): LogEvent[] {
  const state = fold(events)
  const decidedAt = state.cards[id]?.decidedAt
  if (decidedAt === undefined) return []
  const watched = new Set([id, ...state.links.filter((l) => l.from === id && l.type === 'depends_on').map((l) => l.to)])
  return events.filter((event) => event.seq > decidedAt && eventIds(event).some((x) => watched.has(x)))
}
