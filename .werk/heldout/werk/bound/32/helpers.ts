/** Shared helpers of the held-out tests. They only read and drive the product. */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'bun:test'
import type { Project, RunResult } from '../src/test/cli-harness.ts'

export const REPO = join(import.meta.dir, '..')

let seq = 0
/** Appends raw events to the log of a project, the way the existing e2e specs seed a map. */
export function appendEvents(dir: string, ...events: [type: string, payload: object][]) {
  mkdirSync(join(dir, '.werk'), { recursive: true })
  const lines = events.map(([type, payload]) =>
    JSON.stringify({ seq: ++seq, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type, payload }),
  )
  appendFileSync(join(dir, '.werk', 'log.jsonl'), `${lines.join('\n')}\n`)
}

export const logPath = (dir: string) => join(dir, '.werk', 'log.jsonl')
export const readLog = (dir: string) => (existsSync(logPath(dir)) ? readFileSync(logPath(dir), 'utf8') : '')

/** Runs a werk verb and expects it to succeed. The failure message carries the output. */
export async function ok(project: Project, ...args: string[]): Promise<RunResult> {
  const r = await project.werk(...args)
  expect({ cmd: `werk ${args.join(' ')}`, code: r.code, out: r.stdout + r.stderr }).toMatchObject({ code: 0 })
  return r
}
