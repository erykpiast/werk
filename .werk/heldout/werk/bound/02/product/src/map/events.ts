/**
 * The events of the log (#pr-log). Every change to the map is one event, added to the end.
 * Nothing is deleted: a removed card is one more event, so it can come back.
 */

/** A card is a decision. An option is a rejected alternative. A source holds a finding. */
export type Kind = 'card' | 'option' | 'source'

/** The four link types (#vi-edges). */
export type LinkType = 'refines' | 'depends_on' | 'supported_by' | 'alternative_to'

export const KINDS: readonly Kind[] = ['card', 'option', 'source']
export const LINK_TYPES: readonly LinkType[] = ['refines', 'depends_on', 'supported_by', 'alternative_to']

/** A text field of a card that an edit can replace. */
export type Field = 'body' | 'why' | 'whyNot'
export const FIELDS: readonly Field[] = ['body', 'why', 'whyNot']

/** What an event says, before the log gives it a place. */
export type EventBody =
  /** With a parent, the new card refines it: the card and its place are one change. */
  | { type: 'added'; id: string; kind: Kind; title: string; why?: string; body?: string; whyNot?: string; parent?: string }
  | { type: 'linked'; from: string; to: string; link: LinkType; why?: string }
  | { type: 'retitled'; id: string; title: string }
  | { type: 'edited'; id: string; field: Field; text: string }
  | { type: 'decided'; id: string }
  | { type: 'reopened'; id: string; why: string }
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
      : event.type === 'added' && event.parent !== undefined
        ? `#${event.id} refines #${event.parent}`
        : `#${event.id}`
  return `${event.seq} ${event.type} ${about}`
}

/** The ids an event is about: the card it changes, both ends of a link, or a new card and its parent. */
export function eventIds(event: EventBody): string[] {
  if (event.type === 'linked') return [event.from, event.to]
  if (event.type === 'added' && event.parent !== undefined) return [event.id, event.parent]
  return [event.id]
}
