import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveHello, makeProject, startServe, type RunningServer, type TempProject } from '../../test/harness.ts'

let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  server = undefined
  project = undefined
})

const post = (port: number, body: string, headers: Record<string, string> = {}) =>
  fetch(`http://localhost:${port}/api/chat`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })

test('a chat turn with a body that is not JSON is refused with 400 and starts no agent', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const res = await post(server.port, 'hello')
  expect(res.status).toBe(400)
  expect(((await res.json()) as { error: string }).error).toContain('JSON')
  expect((await liveHello(server.port)).children).toEqual([])
})

test('a chat turn from a page on another origin is refused with 403 and starts no agent', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const res = await post(server.port, '{"text":"one"}', { origin: 'https://evil.example' })
  expect(res.status).toBe(403)
  expect((await liveHello(server.port)).children).toEqual([])
})

test('a chat turn from a page werk served is accepted', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const res = await post(server.port, '{"text":"one"}', { origin: `http://localhost:${server.port}` })
  expect(res.status).toBe(200)
})

test('a chat turn sent as text/plain, which needs no preflight, is refused with 415 and starts no agent', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  const res = await post(server.port, '{"text":"one"}', { 'content-type': 'text/plain' })
  expect(res.status).toBe(415)
  expect((await liveHello(server.port)).children).toEqual([])
})

test('a request that names another host, as a DNS rebinding page does, is refused with 403', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  for (const path of ['/api/live', '/api/map', '/']) {
    const res = await fetch(`http://localhost:${server.port}${path}`, { headers: { host: `evil.example:${server.port}` } })
    expect(res.status).toBe(403)
  }
  const res = await post(server.port, '{"text":"one"}', { host: `evil.example:${server.port}` })
  expect(res.status).toBe(403)
  expect((await liveHello(server.port)).children).toEqual([])
})

test('the server listens on the loopback interface only', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  expect((await fetch(`http://127.0.0.1:${server.port}/api/project`)).status).toBe(200)
  expect(server.output()).toContain(`at http://localhost:${server.port} `)
  const address = (await (await fetch(`http://localhost:${server.port}/api/health`)).json()) as { host: string }
  expect(address.host).toBe('127.0.0.1')
})

test('a chat turn with no text is refused with 400', async () => {
  project = makeProject()
  server = await startServe(project.dir)
  for (const body of ['{}', '{"text":"  "}', '{"text":3}']) expect((await post(server.port, body)).status).toBe(400)
  expect((await liveHello(server.port)).children).toEqual([])
})

test('every turn goes to the one stream-json agent child, started in the project directory', async () => {
  project = makeProject()
  const calls = join(project.dir, 'calls.jsonl')
  server = await startServe(project.dir, { env: { WERK_FAKE_CALLS: calls } })
  const first = (await (await post(server.port, '{"text":"one"}')).json()) as { pid: number }
  const second = (await (await post(server.port, '{"text":"two"}')).json()) as { pid: number }
  expect(second.pid).toBe(first.pid)
  expect((await liveHello(server.port)).children).toEqual([{ name: 'chat', pid: first.pid }])
  for (let i = 0; i < 100 && !existsSync(calls); i++) await Bun.sleep(50)
  const lines = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  expect(lines).toEqual([{ argv: ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'], cwd: project.dir }])
})

test('when claude cannot start, the turn fails with 502 and the server keeps running', async () => {
  project = makeProject()
  server = await startServe(project.dir, { env: { PATH: '/nonexistent' } })
  const res = await post(server.port, '{"text":"one"}')
  expect(res.status).toBe(502)
  expect(((await res.json()) as { error: string }).error).toContain('claude')
  await Bun.sleep(200)
  expect((await fetch(`http://localhost:${server.port}/api/project`)).status).toBe(200)
  expect((await liveHello(server.port)).children).toEqual([])
})
