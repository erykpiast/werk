/** Shared helpers for the held-out binds of groups 62-65. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, serveProject, type Project } from '../../src/test/harness.ts'
import { logOf } from '../../src/test/map-events.ts'
import type { NewEvent } from '../../src/map/events.ts'

export { makeProject, type Project }
export * from '../../src/test/map-events.ts'

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')

/** Writes the Given log of a map straight to the project's log file. */
export function seed(p: Project, events: NewEvent[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(p), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
}

export const logLines = (p: Project): string[] => {
  try {
    return readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}
export const logEvents = (p: Project) => logLines(p).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })

export const show = (p: Project, id: string) => p.werk(['show', id])

/** Runs werk and fails loudly when the command fails: for Given steps. */
export function ok(p: Project, args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stdout}${r.stderr}`)
  return r
}

type Graph = { nodes: { id: string; proposed: boolean; status?: string }[]; marks: Record<string, { mark: string }> }

/** The data the map in the browser draws: GET /api/graph of a real werk server on the project. */
export async function mapGraph(p: Project, server?: { url: Promise<string> }): Promise<Graph> {
  const s = server ?? serveProject(p)
  const url = await s.url
  const res = await fetch(`${url}api/graph`)
  return (await res.json()) as Graph
}
export const startServer = (p: Project) => serveProject(p)

/** A decided card with every contract fact: a decider, no-basis waiver or a parent, a kill criterion. */
export const decidedRoot = (id: string, title?: string): NewEvent[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title: title ?? `title of ${id}`, who: 'me', status: 'decided', noBasis: 'the root' } as never },
  { type: 'node.accepted', payload: { id } },
  { type: 'kill.recorded', payload: { id, criterion: { form: 'manual', text: `use ${id} for a week` } } },
]

// A server start and many CLI runs take longer than the default 5 s on a busy machine.
import { setDefaultTimeout } from 'bun:test'
setDefaultTimeout(60_000)
