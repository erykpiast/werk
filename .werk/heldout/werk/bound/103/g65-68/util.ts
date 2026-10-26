import { expect } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewEvent } from '../../src/map/events.ts'
import type { Graph } from '../../src/map/graph.ts'
import { makeProject, serveProject, type Project } from '../../src/test/harness.ts'
import { accepted, killed, logOf, noBasis, proposed, statusSet, whoSet } from '../../src/test/map-events.ts'

export const SLOW = 60_000

/** A real card; a decided one has the four decide facts on record. */
export const card = (id: string, status: 'open' | 'decided', parent?: string, title = `Card ${id}`): NewEvent[] => [
  proposed(id, { title, status: 'open', ...(parent !== undefined && { parent }) }),
  accepted(id),
  ...(status === 'decided' ? [whoSet(id, 'me'), noBasis(id, 'a test card'), killed(id), statusSet(id, 'decided')] : []),
]

export function seeded(...events: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(logFile(p), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
  return p
}

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
export const logLines = (p: Project) => {
  try {
    return readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  expect(r, `werk ${args.join(' ')}`).toMatchObject({ code: 0 })
  return r.stdout
}

/** The graph the map reads, from a running werk server on the project. */
export async function mapGraph(p: Project): Promise<Graph> {
  const s = serveProject(p)
  const url = await s.url
  const g = (await (await fetch(`${url}api/graph`)).json()) as Graph
  await s.stop()
  return g
}
