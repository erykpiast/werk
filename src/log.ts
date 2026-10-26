import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import { fold } from './fold.ts'
import { fileDecisionFollowUp } from './follow-up.ts'
import { paths } from './project.ts'
import { openFollowUp } from './run-state.ts'
import { ticketWatch } from './ticket-watch.ts'
import type { Event, EventType } from './types.ts'

export function readEvents(path = paths.log): Event[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as Event
      } catch (err) {
        throw new Error(`${path}:${i + 1} is not valid JSON: ${(err as Error).message}`)
      }
    })
}

/** Append one event. The seq and the timestamp are assigned here, not by the caller. */
export function append(
  type: EventType,
  payload: unknown,
  opts: { actor?: 'you' | 'agent'; path?: string; at?: string } = {},
): Event {
  const path = opts.path ?? paths.log
  mkdirSync(dirname(path), { recursive: true })
  const prev = readEvents(path)
  const event: Event = {
    seq: prev.length === 0 ? 1 : prev[prev.length - 1].seq + 1,
    at: opts.at ?? new Date().toISOString(),
    actor: opts.actor ?? 'agent',
    type,
    payload,
  }
  appendFileSync(path, JSON.stringify(event) + '\n')
  watchTickets([...prev, event], boardBeside(path))
  return event
}

/**
 * Every writer of a card appends here, so this is where the open tickets are checked against
 * the change (#st-ticket-watch). The board sits beside the log. A project with no board has
 * no tickets, and the watch does nothing.
 */
function boardBeside(logPath: string): string {
  return logPath === paths.log ? paths.board : join(dirname(logPath), 'board.jsonl')
}

export function watchTickets(events: Event[], boardPath: string): void {
  if (!existsSync(boardPath)) return
  try {
    const g = fold(events)
    const board = foldBoard(readBoard(boardPath))
    for (const e of ticketWatch(g, board)) {
      if (e.type !== 'decision.changed') {
        appendBoard(e.type, e.payload, { path: boardPath })
        continue
      }
      // #st-build-missing-decision: the merged ticket stays done; a follow-up reworks it. The
      // tickets live beside the .werk directory that holds the board.
      const of = board.tickets.get(e.payload.id)!
      const live = (id: string) => g.nodes.has(id)
      // #st-followup-one-open: a rework that has not started takes the new changes in place.
      const open = openFollowUp([...board.tickets.values()], of.id, 'rework')
      const followUp = fileDecisionFollowUp(dirname(dirname(boardPath)), { of, changes: e.payload.changes, live, boardPath, open: open && !open.started ? open.ticket : undefined })
      appendBoard('ticket.decision-changed', { id: of.id, reason: e.payload.reason, followUp }, { path: boardPath })
    }
  } catch (err) {
    // The card change is already written. A failed watch must not undo or hide it.
    console.error(`werk: the ticket watch failed: ${(err as Error).message}`)
  }
}

/** Append many events in one pass. Used by the importer. */
export function appendMany(
  events: Array<{ type: EventType; payload: unknown; actor?: 'you' | 'agent'; at?: string }>,
  path = paths.log,
): number {
  mkdirSync(dirname(path), { recursive: true })
  const prev = readEvents(path)
  let seq = prev.length === 0 ? 0 : prev[prev.length - 1].seq
  const at = new Date().toISOString()
  const written: Event[] = events.map((e) => {
    seq += 1
    return { seq, at: e.at ?? at, actor: e.actor ?? 'agent', type: e.type, payload: e.payload }
  })
  appendFileSync(path, written.map((e) => JSON.stringify(e)).join('\n') + '\n')
  watchTickets([...prev, ...written], boardBeside(path))
  return written.length
}
