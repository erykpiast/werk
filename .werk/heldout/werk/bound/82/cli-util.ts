import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Event } from '../src/map/events.ts'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import { makeProject, type Project } from '../src/test/harness.ts'

export type P = Project & {
  w: (...args: string[]) => { code: number; stdout: string; stderr: string; all: string }
  lines: () => string[]
  log: () => Event[]
  state: () => ReturnType<typeof fold>
  seed: (events: object[]) => void
  ok: (...args: string[]) => string
}

export function project(): P {
  const p = makeProject() as P
  const logFile = join(p.dir, '.werk', 'log.jsonl')
  p.w = (...args) => {
    const r = p.werk(args)
    return { ...r, all: r.stdout + r.stderr }
  }
  p.ok = (...args) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stdout}${r.stderr}`)
    return r.stdout
  }
  p.lines = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l !== '') : [])
  p.log = () => readLog<Event>(logFile)
  p.state = () => fold(p.log())
  /** Writes Given events straight to the log, each with the next seq. */
  p.seed = (events) => {
    mkdirSync(join(p.dir, '.werk'), { recursive: true })
    const prev = p.lines().length
    const text = events
      .map((e, i) => JSON.stringify({ seq: prev + i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e }))
      .join('\n')
    writeFileSync(logFile, (prev ? readFileSync(logFile, 'utf8') : '') + text + '\n')
  }
  return p
}

export const prop = (id: string, fields: Record<string, unknown> = {}) => ({
  type: 'node.proposed',
  payload: { id, kind: 'card', title: `title of ${id}`, ...fields },
})
export const acc = (id: string) => ({ type: 'node.accepted', actor: 'you', payload: { id } })
export const lnk = (from: string, to: string, type: string) => ({ type: 'edge.linked', payload: { from, to, type } })
export const kil = (id: string) => ({ type: 'kill.recorded', payload: { id, criterion: { form: 'manual', text: `use ${id} for a week` } } })
