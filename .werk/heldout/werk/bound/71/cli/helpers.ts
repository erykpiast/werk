import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { makeProject, type Project, type RunResult } from '../../src/test/harness.ts'

export { makeProject, type Project, type RunResult }

export const logLines = (p: Project): string[] => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}

export const logEvents = (p: Project) => logLines(p).map((l) => JSON.parse(l) as { type: string; actor: string; payload: Record<string, unknown> })

/** Runs werk and expects exit 0. */
export const ok = (p: Project, args: string[]): RunResult => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}

export const out = (r: RunResult) => r.stdout + r.stderr

/** Expects exactly one more line at the end, and earlier lines unchanged. */
export const expectOneAppended = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

export const show = (p: Project, id: string) => p.werk(['show', id]).stdout
export const isGhost = (p: Project, id: string) => show(p, id).includes('state: ghost')
export const isReal = (p: Project, id: string) => show(p, id).includes('state: real')

/** Gives a card the facts the decide check needs (who, basis, kill), then decides it. */
export const decide = (p: Project, id: string, opts: { who?: string; basis?: boolean } = {}) => {
  ok(p, ['edit', id, '--who', opts.who ?? 'me'])
  if (opts.basis !== true) ok(p, ['edit', id, '--no-basis', 'a root decision'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['status', id, 'decided'])
}
