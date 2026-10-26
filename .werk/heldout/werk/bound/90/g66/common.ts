import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../../src/map/events.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, killed, logOf, noBasis, proposed, statusSet, whoSet } from '../../src/test/map-events.ts'

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const logLines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])
export const logSize = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p)).length : 0)

/** A real card with a title. A decided one has the decide facts on record. */
export const card = (id: string, title: string, status: 'open' | 'decided', parent?: string): NewEvent[] => [
  proposed(id, { title, status: 'open', ...(parent !== undefined && { parent }) }),
  accepted(id),
  ...(status === 'decided' ? [whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided')] : []),
]

export function projectWith(events: NewEvent[]): Project {
  const p = makeProject()
  if (events.length > 0) {
    mkdirSync(join(p.dir, '.werk'), { recursive: true })
    writeFileSync(logFile(p), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
  }
  return p
}

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  expect({ args, code: r.code, stderr: r.stderr }).toEqual({ args, code: 0, stderr: '' })
  return r.stdout
}

/** Writes a session transcript where Claude Code keeps it, under HOME/.claude/projects. */
export function writeSession(p: Project, session: string, lines: unknown[]) {
  const dir = join(p.env.HOME!, '.claude', 'projects', '-some-worktree')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${session}.jsonl`)
  writeFileSync(path, lines.map((l) => JSON.stringify(l) + '\n').join(''))
  return path
}

export const userLine = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
export const assistantLine = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
