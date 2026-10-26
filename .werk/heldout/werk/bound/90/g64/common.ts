import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../../src/map/events.ts'
import { graphOf } from '../../src/map/graph.ts'
import { readLog } from '../../src/map/log.ts'
import type { Project } from '../../src/test/harness.ts'
import { logOf } from '../../src/test/map-events.ts'

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const lines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  expect({ args, code: r.code, stderr: r.stderr }).toEqual({ args, code: 0, stderr: '' })
  return r
}

/** The map as the browser gets it from /api/graph. */
export const graph = (p: Project) => graphOf(readLog(logFile(p)))
export const mapStatus = (p: Project, id: string) => graph(p).nodes.find((n) => n.id === id)?.status
export const mapMark = (p: Project, id: string) => graph(p).marks[id]?.mark

export const writeLog = (p: Project, ...evs: NewEvent[]) => {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(p), logOf(...evs).map((e) => JSON.stringify(e) + '\n').join(''))
}

/** The printed command lines: indented lines that start with `werk`. */
export const printedCommands = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^\s+werk /.test(l))
    .map((l) => l.trim())

/** Runs one printed line as a shell would. */
export const runPrinted = (p: Project, line: string) => {
  for (const command of line.split(' && ')) {
    const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(words[0]).toBe('werk')
    ok(p, words.slice(1))
  }
}
