/** Shared setup for the g5 held-out tests: a project seeded with a log, and the map as the server serves it. */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, serveProject, type Project } from '../../src/test/harness.ts'
import { logOf } from '../../src/test/map-events.ts'
import type { NewEvent } from '../../src/map/events.ts'

export function seeded(events: NewEvent[]): Project {
  const p = makeProject()
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e) + '\n').join(''))
  return p
}

export const logLines = (p: Project): string[] => {
  const path = join(p.dir, '.werk', 'log.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}

type Graph = { nodes: { id: string; proposed?: boolean; title: string }[]; edges: { from: string; to: string; type: string }[]; ghostEdges: { from: string; to: string; type: string }[] }

/** The map as the running server sends it to the browser. */
export async function mapOf(p: Project): Promise<{ graph: Graph; parentOf: (id: string) => string | undefined; has: (id: string) => boolean }> {
  const server = serveProject(p)
  const url = await server.url
  const graph = (await (await fetch(`${url}api/graph`)).json()) as Graph
  await server.stop()
  const parents = new Map([...graph.edges, ...graph.ghostEdges].filter((e) => e.type === 'refines').map((e) => [e.from, e.to]))
  return { graph, parentOf: (id) => parents.get(id), has: (id) => graph.nodes.some((n) => n.id === id) }
}
