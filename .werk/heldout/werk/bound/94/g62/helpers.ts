import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { makeProject, type Project } from '../../src/test/harness.ts'

export { makeProject, type Project }

export const logLines = (p: Project): string[] => {
  const f = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
}
export const logText = (p: Project) => {
  const f = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}
export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stdout}${r.stderr}`)
  return r
}
export const show = (p: Project, id: string) => p.werk(['show', id])
export const isGhost = (out: string) => out.includes('state: ghost')
export const isReal = (out: string) => out.includes('state: real')

/** Appending exactly one line: every earlier line is unchanged. */
export const expectOneMore = (before: string[], after: string[]) => {
  expect(after.length).toBe(before.length + 1)
  expect(after.slice(0, before.length)).toEqual(before)
}

export const realCard = (p: Project, id: string, title: string, parent?: string) => {
  ok(p, ['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
  ok(p, ['accept', id, '--actor', 'you'])
}

/** A real decided card with every fact the contract asks for. */
export const decidedCard = (p: Project, id: string, title: string, parent?: string) => {
  realCard(p, id, title, parent)
  ok(p, ['edit', id, '--who', 'agent', ...(parent ? [] : ['--no-basis', 'a root card'])])
  ok(p, ['kill', id, '--form', 'manual', '--text', `use ${id} a week`])
  ok(p, ['status', id, 'decided'])
}
