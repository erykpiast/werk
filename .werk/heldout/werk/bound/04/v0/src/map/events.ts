/**
 * The events of the log (#pr-log). Every change to the map is one event, added to the end.
 * Nothing is deleted: a removed card is one more event, so it can come back.
 */

/**
 * A card is a decision. An option is a rejected alternative. A source holds a finding. An
 * excerpt holds verbatim words from the conversation, as evidence a card is supported_by.
 */
export type Kind = 'card' | 'option' | 'source' | 'excerpt'

/** The four link types (#vi-edges). */
export type LinkType = 'refines' | 'depends_on' | 'supported_by' | 'alternative_to'

export const KINDS: readonly Kind[] = ['card', 'option', 'source', 'excerpt']
export const LINK_TYPES: readonly LinkType[] = ['refines', 'depends_on', 'supported_by', 'alternative_to']

/** Who decides a card (#werk-contract-facts): the person, the agent, or a prototype. */
export type Who = 'you' | 'me' | 'prototype'
export const WHOS: readonly Who[] = ['you', 'me', 'prototype']

/**
 * A fact of the decide contract that is recorded on its own, not written in the card text.
 * `noBasis` and `unchallenged` are waivers: their value is the written reason.
 */
export type RecordedFact = 'who' | 'noBasis' | 'unchallenged'
export const FACTS: readonly RecordedFact[] = ['who', 'noBasis', 'unchallenged']

/** A text field of a card that an edit can replace. */
export type Field = 'body' | 'why' | 'whyNot'
export const FIELDS: readonly Field[] = ['body', 'why', 'whyNot']

/**
 * Why a decided card is open again (#pr-wf-paused). Postponed: the content still holds and
 * the work waits. Rejected: the content is wrong.
 */
export type ReopenReason = 'postponed' | 'rejected'
export const REOPEN_REASONS: readonly ReopenReason[] = ['postponed', 'rejected']

/**
 * A new node and its words. With a parent, the node refines it: the node and its place are
 * one change. With alternativeTo, the new option is an alternative_to that card in the same
 * change.
 */
export type NewNode = { id: string; kind: Kind; title: string; why?: string; body?: string; whyNot?: string; parent?: string; alternativeTo?: string; who?: Who }

/** What an event says, before the log gives it a place. */
export type EventBody =
  /** A real node, in the map at once. No command writes it; a log written before #werk-propose-new holds it. */
  | ({ type: 'added' } & NewNode)
  /**
   * A ghost (#werk-propose-new): a node that waits for the person's accept. It is in the
   * log at once, and outside every derivation until the accept. Its words are frozen.
   */
  | ({ type: 'proposed' } & NewNode)
  /** The person accepts one ghost. Its ghost refines parents, options and evidence come with it. */
  | { type: 'accepted'; id: string }
  /** Drops one ghost and its ghost descendants. The same id may be proposed again. */
  | { type: 'discarded'; id: string }
  | { type: 'linked'; from: string; to: string; link: LinkType; why?: string }
  | { type: 'retitled'; id: string; title: string }
  | { type: 'edited'; id: string; field: Field; text: string }
  | { type: 'decided'; id: string }
  /** Sets one contract fact on a card. A later record of the same fact replaces it. */
  | { type: 'recorded'; id: string; fact: RecordedFact; value: string }
  /** Adds one kill criterion to a card (#kill-ask): what must become true to revisit it. */
  | { type: 'killAdded'; id: string; text: string }
  | { type: 'reopened'; id: string; reason: ReopenReason; why: string }
  | { type: 'removed'; id: string }
  | { type: 'restored'; id: string }
  /** A verbatim excerpt from the conversation, attributed (#vi-detail). */
  | { type: 'said'; id: string; who: string; text: string }
  /** The finding of a source is in dispute. Every card it supports needs a review. */
  | { type: 'disputed'; id: string; why: string }

/** An event in the log. `seq` is its place: 1 for the first line, and it only grows. */
export type LogEvent = EventBody & { seq: number; at: string }

/** One line that names an event: its place, its type, and what it is about. */
export function describeEvent(event: LogEvent): string {
  const about =
    event.type === 'linked'
      ? `#${event.from} ${event.link} #${event.to}`
      : isNewNode(event) && event.parent !== undefined
        ? `#${event.id} refines #${event.parent}`
        : isNewNode(event) && event.alternativeTo !== undefined
          ? `#${event.id} alternative_to #${event.alternativeTo}`
          : `#${event.id}`
  return `${event.seq} ${event.type} ${about}`
}

/** The ids an event is about: the card it changes, both ends of a link, or a new card and the card it links to. */
export function eventIds(event: EventBody): string[] {
  if (event.type === 'linked') return [event.from, event.to]
  if (isNewNode(event) && event.parent !== undefined) return [event.id, event.parent]
  if (isNewNode(event) && event.alternativeTo !== undefined) return [event.id, event.alternativeTo]
  return [event.id]
}

/** True for an event that brings a new node: a real one, or a ghost. */
export function isNewNode(event: EventBody): event is Extract<EventBody, { type: 'added' | 'proposed' }> {
  return event.type === 'added' || event.type === 'proposed'
}
