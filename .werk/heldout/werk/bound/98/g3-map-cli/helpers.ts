import { expect } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../../src/map/events.ts'
import { makeProject, serveProject, type Project } from '../../src/test/harness.ts'
import { accepted, killed, logOf, noBasis, proposed, statusSet, whoSet } from '../../src/test/map-events.ts'

/** A real card. A decided one has the four decide facts on record. */
export const card = (id: string, status: 'open' | 'decided', parent?: string, title = `Card ${id}`): NewEvent[] => [
  proposed(id, { title, status: 'open', ...(parent !== undefined && { parent }) }),
  accepted(id),
  ...(status === 'decided' ? [whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided')] : []),
]

export function projectWith(...events: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
  return p
}

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const logLines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  expect(r, `werk ${args.join(' ')}`).toMatchObject({ code: 0 })
  return r.stdout
}

type Graph = { marks: Record<string, { id: string; mark: string; traces: unknown[] }>; nodes: unknown }

/** The graph the served map reads. */
export async function servedGraph(p: Project): Promise<Graph> {
  const s = serveProject(p)
  const url = await s.url
  const g = (await (await fetch(`${url}api/graph`)).json()) as Graph
  await s.stop()
  return g
}
