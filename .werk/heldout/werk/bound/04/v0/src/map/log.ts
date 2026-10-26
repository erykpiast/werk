/**
 * The log on disk: one JSON event per line in the project's `.werk/log.jsonl`. Lines are
 * only ever added to the end (#pr-log).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { contractCheck } from './contract.ts'
import type { EventBody, LogEvent } from './events.ts'
import { check, fold, type MapState } from './fold.ts'

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

export type AppendResult = { ok: true; event: LogEvent } | { ok: false; message: string }

/**
 * Checks one event against the map and the decide contract (#werk-contract), and appends it
 * as one line at the end of the log. It gets the next place in the log and the time it was
 * written. The lines above it are never rewritten. A refused event writes nothing.
 */
export function appendEvent(path: string, body: EventBody, now = new Date()): AppendResult {
  const state = fold(readLog(path))
  const problem = check(state, body) ?? contractCheck(state, body)
  if (problem) return { ok: false, message: problem }
  const event = { ...body, seq: state.seq + 1, at: now.toISOString() } as LogEvent
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`)
  return { ok: true, event }
}
