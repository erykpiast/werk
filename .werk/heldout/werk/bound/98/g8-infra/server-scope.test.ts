/** 95.2: a server test's server stops when the test ends. Run from the repo root, with the unit test preload. */
import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { makeProject, serveProject } from '../../src/test/harness.ts'

let url = ''
let dir = ''

test('95.2 (the server test) serves an empty map on its own port', async () => {
  const p = makeProject()
  dir = p.dir
  const server = serveProject(p)
  url = await server.url
  const graph = (await (await fetch(`${url}api/graph`)).json()) as { nodes?: unknown[] }
  console.log('graph', JSON.stringify(graph).slice(0, 200))
  expect(graph.nodes ?? []).toEqual([])
}, 30_000)

test('95.2 after the test ends, the port answers no request and the project is gone', async () => {
  expect(url).not.toBe('')
  let answered = true
  try {
    await fetch(`${url}api/graph`, { signal: AbortSignal.timeout(2000) })
  } catch {
    answered = false
  }
  expect(answered).toBe(false)
  expect(existsSync(dir)).toBe(false)
})
