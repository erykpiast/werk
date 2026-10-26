/**
 * The fold: the log in, the map out (#pr-log). It reads the events from the top, and each
 * event changes the state that the events above it built. A pure module: no I/O.
 *
 * The state is plain JSON, so the server can send it to the client as it is.
 */
import { eventIds, FACTS, FIELDS, KINDS, LINK_TYPES, WHOS, type EventBody, type Kind, type LinkType, type LogEvent, type Who } from './events.ts'

/** A verbatim excerpt on a card, attributed. */
export type Say = { who: string; text: string; seq: number }

/** Why a card is marked: which card changed, at which event, and along which link. */
export type Mark = { because: string; seq: number; via: LinkType; why?: string }

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
  /** Marks from a change one hop away, over refines or depends_on. A decide clears them. */
  stale: Mark[]
  /** Marks from a disputed source, over supported_by. Never stale. A decide clears them. */
  review: Mark[]
}

export type Link = { from: string; to: string; type: LinkType; why: string; seq: number }

/** An event the fold refused, with the reason. The event stays in the log. */
export type Problem = { seq: number; message: string }

export type MapState = {
  cards: Record<string, Card>
  links: Link[]
  problems: Problem[]
  /** The seq of the last event folded, 0 for an empty log. */
  seq: number
}

export function emptyMap(): MapState {
  return { cards: {}, links: [], problems: [], seq: 0 }
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
  const next: MapState = { cards: { ...state.cards }, links: state.links, problems: state.problems, seq: event.seq }
  const update = (id: string, change: Partial<Card>) => {
    next.cards[id] = { ...next.cards[id]!, ...change }
  }
  switch (event.type) {
    case 'added':
      next.cards[event.id] = newCard(event)
      if (event.parent !== undefined) next.links = [...state.links, { from: event.id, to: event.parent, type: 'refines', why: '', seq: event.seq }]
      if (event.alternativeTo !== undefined) next.links = [...state.links, { from: event.id, to: event.alternativeTo, type: 'alternative_to', why: '', seq: event.seq }]
      break
    case 'linked':
      next.links = [...state.links, { from: event.from, to: event.to, type: event.link, why: event.why ?? '', seq: event.seq }]
      break
    case 'retitled':
      update(event.id, { title: event.title })
      markChanged(next, event.id, event.seq)
      break
    case 'edited':
      update(event.id, { [event.field]: event.text })
      markChanged(next, event.id, event.seq)
      break
    case 'decided':
      update(event.id, { status: 'decided', decidedAt: event.seq, stale: [], review: [] })
      break
    case 'recorded':
      update(event.id, { [event.fact]: event.value })
      break
    case 'killAdded':
      update(event.id, { kill: [...state.cards[event.id]!.kill, event.text] })
      break
    case 'reopened':
      update(event.id, { status: 'open' })
      markChanged(next, event.id, event.seq, event.why)
      break
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
      for (const link of next.links) {
        if (link.to !== event.id || link.type !== 'supported_by') continue
        update(link.from, { review: [...next.cards[link.from]!.review, { because: event.id, seq: event.seq, via: 'supported_by', why: event.why }] })
      }
      break
  }
  return next
}

function newCard(event: Extract<EventBody, { type: 'added' }>): Card {
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
    review: [],
  }
  if (event.who !== undefined) card.who = event.who
  return card
}

/**
 * A change to a card marks the cards next to it, one hop and no further (#vi-edges):
 * its refines children, and every card that depends_on it. A link made after the change
 * carries no mark from it, because the link is not in the state yet.
 */
function markChanged(state: MapState, id: string, seq: number, why?: string): void {
  for (const link of state.links) {
    if (link.to !== id || (link.type !== 'refines' && link.type !== 'depends_on')) continue
    const card = state.cards[link.from]!
    const mark: Mark = why === undefined ? { because: id, seq, via: link.type } : { because: id, seq, via: link.type, why }
    state.cards[link.from] = { ...card, stale: [...card.stale, mark] }
  }
}

/** The reason an event cannot apply to this state, or undefined when it can. */
export function check(state: MapState, event: EventBody): string | undefined {
  if (event.type === 'added') {
    if (!event.id) return 'a card needs an id'
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
    case 'retitled':
      return event.title ? undefined : `#${event.id} needs a title`
    case 'edited':
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
      return state.cards[event.id]!.status === 'decided' ? undefined : `#${event.id} is not decided`
    case 'removed':
      return state.cards[event.id]!.removed ? `#${event.id} is already removed` : undefined
    case 'restored':
      return state.cards[event.id]!.removed ? undefined : `#${event.id} is not removed`
    case 'said':
      return event.text && event.who ? undefined : 'an excerpt needs its text and who said it'
    case 'disputed':
      return state.cards[event.id]!.kind === 'source' ? undefined : `#${event.id} is not a source`
    default:
      return `unknown event type: ${(event as { type: string }).type}`
  }
}

function checkLink(state: MapState, from: string, to: string, type: LinkType): string | undefined {
  if (!LINK_TYPES.includes(type)) return `unknown link type: ${type}`
  if (from === to) return `#${from} cannot link to itself`
  const source = state.cards[from]!
  const target = state.cards[to]!
  if (state.links.some((l) => l.from === from && l.to === to && l.type === type)) return `#${from} already ${type} #${to}`
  if (source.kind === 'option' && type !== 'alternative_to') return `an option has one link only: alternative_to, not ${type}`
  if (source.kind === 'option' && state.links.some((l) => l.from === from)) return `option #${from} already has its alternative_to link`
  if (type === 'alternative_to' && source.kind !== 'option') return `only an option can be an alternative_to a card`
  if (type === 'alternative_to' && target.kind !== 'card') return `an option is an alternative_to a card, and #${to} is a ${target.kind}`
  if (type === 'supported_by' && target.kind !== 'source') return `supported_by points at a source, and #${to} is a ${target.kind}`
  if (target.kind === 'option') return `an option has one link only, so #${to} cannot be the target of ${type}`
  if (type === 'refines') {
    if (state.links.some((l) => l.from === from && l.type === 'refines')) return `#${from} already refines a parent`
    if (ancestors(state, to).includes(from)) return `#${from} refines #${to} would make a cycle`
  }
  return undefined
}

/** The refines parent of a card, if it has one. */
export function parentOf(state: MapState, id: string): string | undefined {
  return state.links.find((l) => l.from === id && l.type === 'refines')?.to
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
