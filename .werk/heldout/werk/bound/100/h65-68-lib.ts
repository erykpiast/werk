/** Shared setup for the held-out tests of groups 65 to 68. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeProject, serveProject, type Project } from '../src/test/harness.ts'
import { logOf } from '../src/test/map-events.ts'
import type { NewEvent } from '../src/map/events.ts'
import { refinesTree, type Graph, type TreeNode } from '../src/map/graph.ts'

export const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')

/** A project whose log holds these events at the start. */
export function projectWith(events: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(logFile(p), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
  return p
}

export const logLines = (p: Project) => readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean)

/** A card with its decided facts: a decider, no basis needed, and a kill criterion. */
export const decided = (id: string, title: string, extra: Record<string, unknown> = {}): NewEvent[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, status: 'decided', who: 'me', ...extra } } as NewEvent,
  { type: 'node.accepted', payload: { id } },
  { type: 'node.edited', payload: { id, noBasis: 'a test root' } },
  { type: 'kill.recorded', payload: { id, criterion: { form: 'manual', text: `use ${id} for a week` } } },
]
export const card = (id: string, title: string, extra: Record<string, unknown> = {}): NewEvent[] => [
  { type: 'node.proposed', payload: { id, kind: 'card', title, status: 'open', ...extra } } as NewEvent,
  { type: 'node.accepted', payload: { id } },
]
export const dependsOn = (from: string, to: string): NewEvent => ({ type: 'edge.linked', payload: { from, to, type: 'depends_on', why: `${from} uses ${to}` } })

export function werkOk(p: Project, args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r.stdout
}

/** The map as the browser gets it: the graph the server sends on /api/graph. */
export async function mapOf(p: Project): Promise<Graph> {
  const s = serveProject(p)
  const url = await s.url
  const res = await fetch(`${url}api/graph`)
  const g = (await res.json()) as Graph
  await s.stop()
  return g
}

export function findTree(trees: TreeNode[], id: string): TreeNode | undefined {
  for (const t of trees) {
    if (t.node.id === id) return t
    const f = findTree(t.children, id)
    if (f) return f
  }
  return undefined
}
export const childrenInMap = (g: Graph, id: string) => findTree(refinesTree(g), id)?.children.map((c) => c.node.id) ?? []

export { dirname }
