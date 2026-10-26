/**
 * The log on disk: one JSON event per line in the project's `.werk/log.jsonl`. Lines are
 * only ever added to the end (#pr-log).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EventBody, LogEvent } from './events.ts'
import { applyEvent, check, fold, type MapState } from './fold.ts'

export function logPath(projectDir: string): string {
  return join(projectDir, '.werk', 'log.jsonl')
}

/** Every event in the log, in order. A missing log is an empty one. */
export function readLog(path: string): LogEvent[] {
  if (!existsSync(path)) return []
  const events: LogEvent[] = []
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.trim() === '') return
      try {
        events.push(JSON.parse(line) as LogEvent)
      } catch {
        throw new Error(`${path}:${i + 1}: not a JSON event`)
      }
    })
  return events
}

export function readMap(projectDir: string): MapState {
  return fold(readLog(logPath(projectDir)))
}

export type AppendResult = { ok: true; events: LogEvent[] } | { ok: false; message: string }

/**
 * Checks the events against the map, in order, and appends them all or none. Each event
 * gets the next place in the log and the time it was written.
 */
export function appendEvents(path: string, bodies: readonly EventBody[], now = new Date()): AppendResult {
  let state = fold(readLog(path))
  const events: LogEvent[] = []
  for (const body of bodies) {
    const problem = check(state, body)
    if (problem) return { ok: false, message: problem }
    const event = { ...body, seq: state.seq + 1, at: now.toISOString() } as LogEvent
    state = applyEvent(state, event)
    events.push(event)
  }
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, events.map((event) => `${JSON.stringify(event)}\n`).join(''))
  return { ok: true, events }
}
