/**
 * The marks a change puts on the cards next to it, and the trace of each mark. A pure module:
 * the fold calls it with a fresh copy of the cards, and the views read what it wrote.
 *
 * A rejected reopen or an amend marks the next hop stale, in red (#vi-prop). A postponed
 * reopen marks every card downstream paused, in grey (#pr-wf-paused). Stale wins on a card
 * that has both. A dispute flags the cards a source supports for review (#vi-edges).
 */
import type { LinkType, ReopenReason } from './events.ts'
import type { Card, Link } from './fold.ts'

/** The kind of change that put a mark. */
export type Change = 'reopened' | 'retitled' | 'edited' | 'disputed'

/**
 * Why a card is marked (#vi-prop-trace): which card changed, at which event, how, and along
 * which link. A mark from a reopen carries the reopen reason. `path` names the cards the mark
 * passed through, nearest the changed card first. It is empty for a mark one hop away.
 */
export type Mark = {
  because: string
  seq: number
  at: string
  change: Change
  reason?: ReopenReason
  via: LinkType
  path: string[]
  why?: string
}

/** The kind of mark a card shows. */
export type MarkKind = 'stale' | 'paused' | 'review'
export const MARK_KINDS: readonly MarkKind[] = ['stale', 'paused', 'review']

/** What the fold knows about a change when it marks the cards next to it. */
export type ChangeEvent = { id: string; seq: number; at: string; change: Change; reason?: ReopenReason; why?: string }

type Cards = Record<string, Card>

/**
 * The links one hop down from a card: its refines children and its depends_on dependents.
 * An option or a source holds no decision to review, so a mark never lands on one.
 */
function downstream(cards: Cards, links: readonly Link[], id: string): Link[] {
  return links.filter((l) => l.to === id && (l.type === 'refines' || l.type === 'depends_on') && cards[l.from]!.kind === 'card')
}

function markFor(change: ChangeEvent, via: LinkType, path: string[]): Mark {
  const mark: Mark = { because: change.id, seq: change.seq, at: change.at, change: change.change, via, path }
  if (change.reason !== undefined) mark.reason = change.reason
  if (change.why !== undefined) mark.why = change.why
  return mark
}

/**
 * Marks the next hop stale (#vi-prop): a rejected reopen, a retitle or an edit. The links are
 * the ones in the map now, so a link made after the change carries no mark from it.
 */
export function markStale(cards: Cards, links: readonly Link[], change: ChangeEvent): void {
  for (const link of downstream(cards, links, change.id)) {
    const card = cards[link.from]!
    cards[link.from] = { ...card, stale: [...card.stale, markFor(change, link.type, [])] }
  }
}

/**
 * Marks every card downstream paused, at any distance (#pr-wf-paused). A paused card is never
 * reviewed, so the mark cannot move hop by hop. The walk is breadth first, so the path in each
 * trace is a shortest one. A cycle of depends_on links ends at a card already reached.
 */
export function markPaused(cards: Cards, links: readonly Link[], change: ChangeEvent): void {
  const seen = new Set([change.id])
  const queue: { id: string; path: string[] }[] = [{ id: change.id, path: [] }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const link of downstream(cards, links, next.id)) {
      if (seen.has(link.from)) continue
      seen.add(link.from)
      const card = cards[link.from]!
      cards[link.from] = { ...card, paused: [...card.paused, markFor(change, link.type, next.path)] }
      queue.push({ id: link.from, path: [...next.path, link.from] })
    }
  }
}

/** Flags every card the source supports for review. A dispute never marks a card stale. */
export function markReview(cards: Cards, links: readonly Link[], change: ChangeEvent): void {
  for (const link of links) {
    if (link.to !== change.id || link.type !== 'supported_by') continue
    const card = cards[link.from]!
    cards[link.from] = { ...card, review: [...card.review, markFor(change, 'supported_by', [])] }
  }
}

/** Work resumes on a postponed card: the paused marks it caused go, everywhere. */
export function resume(cards: Cards, id: string): void {
  for (const [key, card] of Object.entries(cards)) {
    if (!card.paused.some((mark) => mark.because === id)) continue
    cards[key] = { ...card, paused: card.paused.filter((mark) => mark.because !== id) }
  }
}

/** The mark a card shows on the map. Stale wins over paused: an invalidation never looks calm. */
export function markOf(card: Card): 'stale' | 'paused' | undefined {
  if (card.stale.length > 0) return 'stale'
  if (card.paused.length > 0) return 'paused'
  return undefined
}

/** The marks of one kind on a card. Paused marks hide behind a stale mark, as the mark does. */
export function marksOf(card: Card, kind: MarkKind): Mark[] {
  if (kind === 'paused') return card.stale.length > 0 ? [] : card.paused
  return card[kind]
}

/**
 * One line of trace for a mark, the same in the command line and in the browser:
 * `#a reopened, rejected, on 2026-10-19 (event 7), over depends_on: the why`.
 */
export function describeMark(mark: Mark): string {
  return `#${mark.because} ${describeChange(mark)}`
}

/** The trace of a mark after the id of the changed card, so a view can link the id. */
export function describeChange(mark: Mark): string {
  const how = mark.reason === undefined ? mark.change : `${mark.change}, ${mark.reason},`
  const when = mark.at ? `on ${mark.at.slice(0, 10)} (event ${mark.seq})` : `at event ${mark.seq}`
  const through = mark.path.length > 0 ? ` through ${mark.path.map((id) => `#${id}`).join(', ')}` : ''
  const why = mark.why ? `: ${mark.why}` : ''
  return `${how} ${when}, over ${mark.via}${through}${why}`
}
