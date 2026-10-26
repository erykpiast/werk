// #pr-log-snapshot: the fold is a runtime operation, and its kill criterion watches how long a
// full fold takes. Every read that folds the whole log goes through `foldLog`, which times the
// fold and appends one line to a local file beside the log. #vi-flow-ms-fold draws the lines.
//
// A fold over a prefix of the log (a past state, as the rederive metric and the diagram sync
// take) is not a read of the map, so it is not timed.

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fold } from './fold.ts'
import { readEvents } from './log.ts'
import { paths } from './project.ts'
import type { Graph } from './types.ts'

export type FoldTime = {
  at: string
  /** The log size the fold replayed. */
  events: number
  ms: number
  /** The read that ran the fold: a view, a route, or a command. */
  via: string
}

/** Read the whole log, fold it, and record how long the fold took. */
export function foldLog(via: string, path = paths.foldTimes): Graph {
  const events = readEvents()
  const t = performance.now()
  const g = fold(events)
  const ms = Math.round((performance.now() - t) * 100) / 100
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), events: events.length, ms, via }) + '\n')
  } catch {
    // A read never fails because its timing could not be written.
  }
  return g
}

/** The fold times in a file's text, from `since` on. A line cut off mid-write is skipped. */
export function foldTimes(text: string, since = 0): FoldTime[] {
  const out: FoldTime[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const ms = Number(e?.ms)
    const events = Number(e?.events)
    if (typeof e?.at !== 'string' || !Number.isFinite(ms) || !Number.isFinite(events)) continue
    if (Date.parse(e.at) < since) continue
    out.push({ at: e.at, events, ms, via: String(e.via ?? '') })
  }
  return out
}
