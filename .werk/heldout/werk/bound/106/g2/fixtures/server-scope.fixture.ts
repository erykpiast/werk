/** Run by 95.test.ts as its own bun test run: a server test that ends. */
import { expect, test } from 'bun:test'
import { appendFileSync } from 'node:fs'
import { makeProject, serveProject } from '../../../src/test/harness.ts'

test('a server test', async () => {
  const p = makeProject()
  const server = serveProject(p)
  const url = await server.url
  const graph = (await (await fetch(`${url}api/graph`)).json()) as { nodes?: unknown[]; cards?: unknown[] }
  appendFileSync(process.env.HELDOUT_OUT!, JSON.stringify({ url, dir: p.dir, graph }) + '\n')
  expect(graph).toBeDefined()
}, 30_000)
