/**
 * The time a ticket spends in each board column (#ms-col-time). Pure: a fold over the board log,
 * through the board's own fold, so a column changes here exactly when it changes on the board.
 *
 * A visit runs from the move into a column to the move out of it. The first visit starts when
 * the ticket is planned. Done is not timed. An archive stops the clock, and a restore starts it
 * again in the ticket's column. A visit still running has no end in the log: it carries its
 * start, and the report counts it up to now, the same as an open stop (#vi-flow-ms-waits).
 */
import { foldBoard, type BoardEvent, type Column } from './board.ts'
import { distribution } from './cost.ts'

export type TimedColumn = Exclude<Column, 'done'>
export const TIMED: TimedColumn[] = ['ready', 'blocked', 'building', 'merging']

/** One ticket's time in one column: the sum of its ended visits, how many visits there were,
 *  and the start of the one still running. */
export type ColumnTime = { ticket: string; column: TimedColumn; ms: number; visits: number; openSince?: string }

export function columnTimes(events: BoardEvent[]): ColumnTime[] {
  const out = new Map<string, ColumnTime>()
  const clock = new Map<string, { column: Column; since: string }>()
  const row = (id: string, column: TimedColumn) => {
    const key = `${id}\u0000${column}`
    return out.get(key) ?? out.set(key, { ticket: id, column, ms: 0, visits: 0 }).get(key)!
  }
  const start = (id: string, column: Column, at: string) => {
    clock.set(id, { column, since: at })
    if (column !== 'done') row(id, column).visits += 1
  }
  const stop = (id: string, at: string) => {
    const c = clock.get(id)
    clock.delete(id)
    if (c && c.column !== 'done') row(id, c.column).ms += Date.parse(at) - Date.parse(c.since)
  }
  foldBoard(events, (e, tickets) => {
    const id = (e.payload as { id?: unknown }).id
    const t = typeof id === 'string' ? tickets.get(id) : undefined
    if (!t) return
    const c = clock.get(t.id)
    if (c && (t.archived || c.column !== t.column)) stop(t.id, e.at)
    if (!t.archived && !clock.has(t.id)) start(t.id, t.column, e.at)
  })
  for (const [id, c] of clock) if (c.column !== 'done') row(id, c.column).openSince = c.since
  return [...out.values()]
}

/** Per column, the distribution of the time a ticket spent in it, with each running visit
 *  counted up to `now`, and the tickets still in it. */
export type ColumnRow = { column: TimedColumn; ms: ReturnType<typeof distribution>; open: string[] }

export function columnReport(times: ColumnTime[], now: string): ColumnRow[] {
  const total = (t: ColumnTime) => t.ms + (t.openSince ? Math.max(0, Date.parse(now) - Date.parse(t.openSince)) : 0)
  return TIMED.map((column) => {
    const rows = times.filter((t) => t.column === column)
    return { column, ms: distribution(rows.map(total)), open: rows.filter((t) => t.openSince).map((t) => t.ticket) }
  })
}
