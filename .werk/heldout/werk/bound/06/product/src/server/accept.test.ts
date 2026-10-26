import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, startServe, type RunningServer, type TempProject } from '../../test/harness.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})

const post = (port: number, body: string, headers: Record<string, string> = {}) =>
  fetch(`http://localhost:${port}/api/accept`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })
const logText = (dir: string) => readFileSync(join(dir, '.werk', 'log.jsonl'), 'utf8')

test('the ✓ appends one accept event, and the ghost and its ghost parent are real in the map', async () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A'])
  project.run(['add', 'b', '--title', 'B', '--parent', 'a'])
  server = await startServe(project.dir)
  const before = logText(project.dir)
  const res = await post(server.port, '{"id":"b"}', { origin: `http://localhost:${server.port}` })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ seq: 3 })
  const added = logText(project.dir).slice(before.length).trim().split('\n')
  expect(added.map((line) => JSON.parse(line))).toEqual([expect.objectContaining({ type: 'accepted', id: 'b', seq: 3 })])
  const map = await (await fetch(`http://localhost:${server.port}/api/map`)).json()
  expect(map.cards.a.proposed).toBeUndefined()
  expect(map.cards.b.proposed).toBeUndefined()
  expect(map.links).toEqual([expect.objectContaining({ from: 'b', to: 'a', type: 'refines' })])
}, 30_000)

test('an accept of a card that is not a ghost is refused with 409 and appends nothing', async () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A'])
  project.run(['accept', 'a', '--actor', 'you'])
  server = await startServe(project.dir)
  const before = logText(project.dir)
  const res = await post(server.port, '{"id":"a"}')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: '#a is not a proposal' })
  expect(logText(project.dir)).toBe(before)
}, 30_000)

test('an accept with no single id, from another origin, or not as JSON is refused and appends nothing', async () => {
  project = makeProject()
  project.run(['add', 'a', '--title', 'A'])
  server = await startServe(project.dir)
  const before = logText(project.dir)
  const cases: [string, Record<string, string>, number][] = [
    ['{"id":["a","b"]}', {}, 400],
    ['{"ids":"a"}', {}, 400],
    ['not json', {}, 400],
    ['{"id":"a"}', { origin: 'https://evil.example' }, 403],
    ['{"id":"a"}', { 'content-type': 'text/plain' }, 415],
  ]
  for (const [body, headers, status] of cases) {
    expect({ body, status: (await post(server.port, body, headers)).status }).toEqual({ body, status })
  }
  expect(logText(project.dir)).toBe(before)
}, 30_000)
