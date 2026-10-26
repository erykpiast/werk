/**
 * The outcome measures that fold over logs that exist already (#ms-outcome). Pure: the caller
 * reads the board log and the decision log.
 *
 * - Follow-ups: the records the chat agent wrote, each with its last correction in force
 *   (#ms-outcome-followup).
 * - Escapes: a red merge check that is not a conflict, a red held-out run, and each build-miss
 *   follow-up, by where it was found (#ms-outcome-escape).
 * - Reworked cards: a cited card reopened after the ticket started to build. A reopen that
 *   postpones a card is not rework: the decision still holds (#ms-outcome-rework).
 * - Reworked code: the parts of the git fold that need no repository. rework-code.ts asks git.
 */
import type { BoardEvent, BoardEventMap, FollowUpClass, FollowUpFound } from './board.ts'
import type { Event } from './types.ts'

/** One follow-up, numbered from 1 per ticket, with the fields of its last correction. */
export type FollowUp = {
  ticket: string
  n: number
  at: string
  class: FollowUpClass
  found: FollowUpFound
  why: string
  catchable?: boolean
  /** How many corrections the record has had. */
  corrected: number
}

export function followUps(board: BoardEvent[]): FollowUp[] {
  const byTicket = new Map<string, FollowUp[]>()
  for (const e of board) {
    if (e.type !== 'ticket.followup') continue
    const p = e.payload as BoardEventMap['ticket.followup']
    const list = byTicket.get(p.id) ?? byTicket.set(p.id, []).get(p.id)!
    const fields = { class: p.class, found: p.found, why: p.why, catchable: p.class === 'build' ? p.catchable : undefined }
    const target = p.of === undefined ? undefined : list[p.of - 1]
    if (target) Object.assign(target, fields, { corrected: target.corrected + 1 })
    else if (p.of === undefined) list.push({ ticket: p.id, n: list.length + 1, at: e.at, ...fields, corrected: 0 })
  }
  return [...byTicket.values()].flat().sort((a, b) => a.at.localeCompare(b.at))
}

export type EscapePlace = 'merge' | 'heldout' | FollowUpFound
/** `catchable` is true for an escape a check found, and the record's answer for a follow-up. */
export type Escape = { ticket: string; place: EscapePlace; at: string; catchable: boolean | undefined }

export function escapes(board: BoardEvent[]): Escape[] {
  const out: Escape[] = []
  for (const e of board) {
    if (e.type === 'ticket.merge') {
      const p = e.payload as BoardEventMap['ticket.merge']
      if ((!p.green && !p.conflict) || (p.green && p.failedChecks?.length)) out.push({ ticket: p.id, place: 'merge', at: e.at, catchable: true })
    } else if (e.type === 'ticket.heldout') {
      const p = e.payload as BoardEventMap['ticket.heldout']
      if (!p.green && (p.failed?.length ?? 0) > 0) out.push({ ticket: p.id, place: 'heldout', at: e.at, catchable: true })
    }
  }
  for (const f of followUps(board)) if (f.class === 'build') out.push({ ticket: f.ticket, place: f.found, at: f.at, catchable: f.catchable })
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** How long after a merge a change to the ticket's lines is rework (#ms-outcome-rework). */
export const REWORK_DAYS = 14

/** The green merges the board records, each with the commit the main line moved to. */
export function greenMerges(board: BoardEvent[]): { ticket: string; commit: string; at: string }[] {
  const out: { ticket: string; commit: string; at: string }[] = []
  for (const e of board) {
    if (e.type !== 'ticket.merge') continue
    const p = e.payload as BoardEventMap['ticket.merge']
    if (p.green && p.commit) out.push({ ticket: p.id, commit: p.commit, at: e.at })
  }
  return out
}

/** The pattern that finds a ticket's own commits: each builder pass, and the merge commit. */
export function ticketCommitPattern(ticket: string): string {
  const id = ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `^werk build ${id}: |^werk: merge ${id}$`
}

/** The lines in a `git blame --line-porcelain` output that came from one of `commits`. */
export function blamedLines(porcelain: string, commits: Set<string>): number {
  let n = 0
  for (const m of porcelain.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)) if (commits.has(m[1])) n++
  return n
}

/** The ticket's lines at its merge, and how many of them a later commit changed or removed
 *  within the window. `open` while the window has not ended: the count can still grow.
 *  `gone` marks a merge whose commits the repository no longer names; its counts are zero. */
export type ReworkedCode = { ticket: string; commit: string; at: string; lines: number; changed: number; open: boolean; gone?: true }

export type ReworkedCard = { ticket: string; card: string; at: string }

export function reworkedCards(board: BoardEvent[], decisions: Event[]): ReworkedCard[] {
  const started = new Map<string, string>() // ticket -> its first move to building
  const cites = new Map<string, Set<string>>() // ticket -> every card it cited
  for (const e of board) {
    const p = e.payload as { id?: string; to?: string; cards?: Record<string, unknown> }
    if (!p.id) continue
    if (e.type === 'ticket.moved' && p.to === 'building' && !started.has(p.id)) started.set(p.id, e.at)
    if (e.type === 'ticket.cites') for (const card of Object.keys(p.cards ?? {})) (cites.get(p.id) ?? cites.set(p.id, new Set()).get(p.id)!).add(card)
  }
  const out: ReworkedCard[] = []
  for (const e of decisions) {
    if (e.type !== 'reopened' || e.payload?.reason === 'postponed') continue
    for (const [ticket, at] of started) if (at < e.at && cites.get(ticket)?.has(e.payload.id)) out.push({ ticket, card: e.payload.id, at: e.at })
  }
  return out
}

/** One row of the rework report: a ticket with at least one kind of rework (#werk-cli-rework). */
export type ReworkRow = { ticket: string; cards: string[]; lines: number; changed: number }

export type ReworkReport = {
  rows: ReworkRow[]
  totals: { tickets: number; cards: number; changed: number }
  /** Merges whose window has not ended: their count can still grow. */
  open: string[]
  /** Merges whose commits the repository no longer holds. */
  gone: string[]
}

export function reworkReport(cards: ReworkedCard[], code: ReworkedCode[]): ReworkReport {
  const rows = new Map<string, ReworkRow>()
  const row = (ticket: string) => rows.get(ticket) ?? rows.set(ticket, { ticket, cards: [], lines: 0, changed: 0 }).get(ticket)!
  for (const c of cards) {
    const r = row(c.ticket)
    if (!r.cards.includes(c.card)) r.cards.push(c.card)
  }
  const open: string[] = []
  const gone: string[] = []
  for (const c of code) {
    if (c.gone) {
      gone.push(c.ticket)
      continue
    }
    if (c.open) open.push(c.ticket)
    if (c.changed > 0) {
      const r = row(c.ticket)
      r.lines += c.lines
      r.changed += c.changed
    }
  }
  const list = [...rows.values()].sort((a, b) => a.ticket.localeCompare(b.ticket))
  return {
    rows: list,
    totals: { tickets: list.length, cards: list.reduce((n, r) => n + r.cards.length, 0), changed: list.reduce((n, r) => n + r.changed, 0) },
    open,
    gone,
  }
}
