// #vi-flowtab, #vi-flow-telemetry: the card status loop, read from the log.
//
// Every status change is one timestamped event, so the history of a card is a fold, the same
// as the map itself. This module returns the raw history per card. The page aggregates it
// for the whole map or for one subtree, so a subtree breakdown needs no second round trip.

import { fold } from './fold.ts'
import type { Event } from './types.ts'

export type Step = {
  /** The status before the change. null when the card enters the map. */
  from: string | null
  to: string
  at: string
  /** For a reopen: postponed, invalidated, or rejected. */
  reason?: string
}

export type CardFlow = { id: string; steps: Step[] }

/**
 * The status history of each card. A card enters when it is added, or when its proposal is
 * accepted — a ghost has no status in the map yet. A removed card keeps its history but is
 * marked, so the page can leave it out of the current counts.
 */
export function cardFlows(events: Event[]): { cards: CardFlow[]; removed: string[] } {
  const steps = new Map<string, Step[]>()
  const status = new Map<string, string>()
  const ghosts = new Map<string, string>() // id -> the status it was proposed with
  const removed = new Set<string>()

  const move = (id: string, to: string, at: string, reason?: string) => {
    const from = status.get(id) ?? null
    if (from === to && !reason) return
    const list = steps.get(id) ?? []
    list.push(reason ? { from, to, at, reason } : { from, to, at })
    steps.set(id, list)
    status.set(id, to)
  }

  for (const e of events) {
    const p = e.payload as Record<string, any>
    switch (e.type) {
      case 'node.added':
        if (p.kind !== 'card' || status.has(p.id)) break
        move(p.id, p.status ?? 'open', e.at)
        break
      case 'node.proposed':
        if (p.kind === 'card' && !status.has(p.id)) ghosts.set(p.id, p.status ?? 'open')
        break
      case 'change.discarded':
        ghosts.delete(p.id)
        break
      case 'change.accepted':
        if (ghosts.has(p.id)) {
          move(p.id, ghosts.get(p.id)!, e.at)
          ghosts.delete(p.id)
        }
        break
      case 'status.set':
        if (status.has(p.id)) move(p.id, p.status, e.at)
        break
      case 'rederived':
        if (p.status && status.has(p.id)) move(p.id, p.status, e.at)
        break
      case 'reopened':
        if (status.has(p.id)) move(p.id, 'open', e.at, p.reason ?? 'invalidated')
        break
      case 'node.removed':
        removed.add(p.id)
        break
      case 'node.restored':
        removed.delete(p.id)
        break
    }
  }
  return { cards: [...steps].map(([id, s]) => ({ id, steps: s })), removed: [...removed] }
}

export type Rederive = {
  id: string
  at: string
  /** An amend: the card's title, why, or body changed after the reopen that marked it. */
  changed: boolean
  /** Who made the review. Only reviews by you count toward the kill metric. */
  by: 'you' | 'agent'
}

/**
 * #vi-prop's kill metric: every rederive that cleared a stale mark, whether it was a confirm
 * or an amend, and who made it. A rederive of a card that was not stale counts for nothing.
 * Until a review records its own ending (#rederive-reason), an amend is a text change since
 * the reopen.
 *
 * Whether a card was stale is read from a fold of the log up to the rederive, so it is the
 * same answer `werk stale` gave at that moment. That is one fold per rederive. A past
 * rederive never changes its answer, so `memo` keeps them across calls, keyed by seq.
 */
export function rederives(events: Event[], memo = new Map<string, Rederive | null>()): Rederive[] {
  const out: Rederive[] = []
  const edits = new Map<string, number[]>() // id -> seqs of text changes
  const staged = new Set<string>() // ids with a staged text edit
  const lastReopen = new Map<string, number>() // origin -> seq, the latest one, as fold keeps it
  const edit = (id: string, seq: number) => {
    const list = edits.get(id) ?? []
    list.push(seq)
    edits.set(id, list)
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const p = e.payload as Record<string, any>
    switch (e.type) {
      case 'node.retitled':
        edit(p.id, e.seq)
        break
      case 'option.chosen':
        edit(p.card, e.seq)
        break
      case 'change.proposed':
        if (p.remove) staged.delete(p.id)
        else staged.add(p.id)
        break
      case 'change.discarded':
        staged.delete(p.id)
        break
      case 'change.accepted':
        if (staged.delete(p.id)) {
          edit(p.id, e.seq)
          // The accept of a change to a stale decided card is an amend, and it ends the review
          // of that card — #vi-prop-amended. It counts as a review that changed the card.
          const key = `${e.seq}:${e.at}`
          let r = memo.get(key)
          if (r === undefined) {
            r = fold(events.slice(0, i)).stale.has(p.id) ? { id: p.id, at: e.at, changed: true, by: e.actor } : null
            memo.set(key, r)
          }
          if (r) out.push(r)
        }
        break
      case 'reopened':
        lastReopen.set(p.id, e.seq)
        break
      case 'rederived': {
        const key = `${e.seq}:${e.at}`
        let r = memo.get(key)
        if (r === undefined) {
          const g = fold(events.slice(0, i))
          const traces = g.stale.has(p.id) ? (g.flagWhy.get(p.id) ?? []) : []
          if (traces.length === 0) r = null
          else {
            const since = Math.min(...traces.map((t) => lastReopen.get(t.origin) ?? 0))
            r = {
              id: p.id,
              at: e.at,
              changed: (edits.get(p.id) ?? []).some((s) => s > since),
              by: e.actor,
            }
          }
          memo.set(key, r)
        }
        if (r) out.push(r)
        break
      }
    }
  }
  return out
}

export type ProbeCount = { at: string; samples: number; failed: number }

/**
 * #lp-overseer-psfail-metric: the probe counts one pass event stream holds. A session records
 * one count line when it ends, so a stream with several sessions gives several counts. A line
 * that is not JSON, or not a count, is skipped: the stream is written while a pass runs.
 */
export function probeCounts(stream: string): ProbeCount[] {
  const out: ProbeCount[] = []
  for (const line of stream.split('\n')) {
    if (!line.includes('"probes"')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e?.type !== 'werk_overseer' || e.kind !== 'probes') continue
    const samples = Number(e.samples)
    const failed = Number(e.failed)
    if (!Number.isFinite(samples) || !Number.isFinite(failed) || samples <= 0) continue
    out.push({ at: String(e.at ?? ''), samples, failed: Math.min(Math.max(0, failed), samples) })
  }
  return out
}

export type ChatWait = {
  convo: string
  /** The card the person had open when the turn began, if the message named one. */
  card: string | null
  /** `button`: an unclicked next-action button. `question`: a structured question. */
  kind: 'button' | 'question'
  start: string
  /** Absent while the wait is still open. */
  end?: string
}

/**
 * #ms-outcome-interv-chat-q: every hanging question in the chat pane, and how long it waited.
 *
 * A button wait starts at an agent message whose last line offers a next action, and ends at
 * the next message from the person in that conversation: a click posts the phrase as one. A
 * question wait is one resolved structured question from the ask history, or one still in
 * the bar from `pending`: the history gets a line only when the ask resolves, so an open
 * question is known only to the live queue. An ask line written before asks recorded their
 * start and their conversation is skipped.
 */
export function chatWaits(
  chats: { convo: string; text: string }[],
  asks: string,
  nextPhrase: (text: string) => string | null,
  pending: { tool: string; at: string; convo: string }[] = [],
): ChatWait[] {
  const out: ChatWait[] = []
  // The card of each message from the person, per conversation, for the asks below.
  const cards = new Map<string, { at: string; card: string | null }[]>()
  for (const { convo, text } of chats) {
    const yours: { at: string; card: string | null }[] = []
    let card: string | null = null
    let open: ChatWait | undefined
    for (const m of jsonl(text)) {
      const at = typeof m.at === 'string' ? m.at : ''
      if (m.from === 'you') {
        card = typeof m.card === 'string' ? m.card : null
        yours.push({ at, card })
        if (open) open.end = at
        open = undefined
      } else if (m.from === 'agent' && nextPhrase(String(m.text ?? ''))) {
        if (!open) out.push((open = { convo, card, kind: 'button', start: at }))
      }
    }
    cards.set(convo, yours)
  }
  const cardAt = (convo: string, at: string) => (cards.get(convo) ?? []).filter((y) => y.at <= at).at(-1)?.card ?? null
  for (const a of jsonl(asks)) {
    if (a.tool !== 'AskUserQuestion' || typeof a.asked !== 'string' || typeof a.convo !== 'string') continue
    out.push({ convo: a.convo, card: cardAt(a.convo, a.asked), kind: 'question', start: a.asked, end: String(a.at) })
  }
  for (const a of pending) {
    if (a.tool !== 'AskUserQuestion') continue
    out.push({ convo: a.convo, card: cardAt(a.convo, a.at), kind: 'question', start: a.at })
  }
  return out.sort((x, y) => x.start.localeCompare(y.start))
}

function jsonl(text: string): any[] {
  const out: any[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // A line cut off mid-write: skip it.
    }
  }
  return out
}
