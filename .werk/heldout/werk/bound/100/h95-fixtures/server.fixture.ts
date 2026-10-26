/** Run by h95.test.ts (95.2): a server test that records its port and project. */
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { makeProject, serveProject } from '../../src/test/harness.ts'

test('a server test sees an empty map', async () => {
  const p = makeProject()
  const server = serveProject(p)
  const url = await server.url
  const graph = (await (await fetch(new URL('api/graph', url))).json()) as { nodes?: unknown[] }
  appendFileSync(process.env.H95_OUT!, JSON.stringify({ url, dir: p.dir, graph }) + '\n')
  expect(graph).toBeDefined()
})
