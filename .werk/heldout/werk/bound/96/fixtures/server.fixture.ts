/** 95.2: a server test that asks the harness for a project, serves it, and reads an empty map. */
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { makeProject, serveProject } from '../../src/test/harness.ts'

test('a server test serves an empty map on its own port', async () => {
  const p = makeProject()
  const server = serveProject(p)
  const url = await server.url
  const graph = (await (await fetch(`${url}api/graph`)).json()) as { nodes: unknown[] }
  appendFileSync(process.env.HELDOUT_OUT!, JSON.stringify({ url, dir: p.dir, nodes: graph.nodes.length }) + '\n')
  expect(graph.nodes).toEqual([])
})
