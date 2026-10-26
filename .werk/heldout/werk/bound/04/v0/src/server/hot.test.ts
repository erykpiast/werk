import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logPath } from '../map/log.ts'
import { WERK_ROOT } from '../../test/env.ts'
import { liveHello, makeProject, openLive, startServe, type RunningServer, type TempProject } from '../../test/harness.ts'

/**
 * Each test edits a server module, so it runs a copy of werk, never the source tree.
 */
function copyWerk(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'werk-copy-')))
  for (const part of ['src', 'test', 'package.json', 'tsconfig.json']) cpSync(join(WERK_ROOT, part), join(dir, part), { recursive: true })
  symlinkSync(join(WERK_ROOT, 'node_modules'), join(dir, 'node_modules'))
  return dir
}

const health = async (port: number) =>
  (await (await fetch(`http://localhost:${port}/api/health`)).json()) as { pid: number; bootId: string; handlerLoadedAt: string }

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

let copy: string | undefined
let project: TempProject | undefined
let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  project?.cleanup()
  if (copy) rmSync(copy, { recursive: true, force: true })
  server = undefined
  project = undefined
  copy = undefined
})

const REUSE = /reusing the live server on port (\d+) \(pid (\d+)\)/

/** Sends a chat turn and waits for the agent's result for it on the live channel. */
const chat = async (port: number, text: string) => {
  const controller = new AbortController()
  const live = await fetch(`http://localhost:${port}/api/live`, { signal: controller.signal })
  const reader = live.body!.getReader()
  const res = await fetch(`http://localhost:${port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  expect(res.status).toBe(200)
  const sent = (await res.json()) as { pid: number }
  const decoder = new TextDecoder()
  let stream = ''
  try {
    while (!stream.includes(`"result":${JSON.stringify(text)}`)) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`the live channel closed before the reply to ${text}:\n${stream}`)
      stream += decoder.decode(value, { stream: true })
    }
  } finally {
    controller.abort()
  }
  expect(stream).toContain('event: agent\n')
  return sent
}

test('under the dev command, an edit to a server module reloads it in the same process', async () => {
  copy = copyWerk()
  project = makeProject()
  server = await startServe(project.dir, { hot: true, entry: join(copy, 'src', 'cli.ts') })
  const before = await health(server.port)

  appendFileSync(join(copy, 'src', 'server', 'app.ts'), '\n// an edit\n')
  const reuse = await server.waitFor(REUSE)

  expect(Number(reuse[1])).toBe(server.port)
  expect(Number(reuse[2])).toBe(server.process.pid!)
  const after = await health(server.port)
  expect(after.pid).toBe(before.pid)
  expect(after.bootId).toBe(before.bootId)
  expect(after.handlerLoadedAt).not.toBe(before.handlerLoadedAt)
  expect(server.output().match(/werk: serving /g)).toHaveLength(1)
}, 60_000)

test('a long-lived child and the live channel state survive a hot reload', async () => {
  copy = copyWerk()
  project = makeProject()
  const script = join(project.dir, 'hold.json')
  writeFileSync(script, JSON.stringify([{ hold: true }]))
  server = await startServe(project.dir, { hot: true, entry: join(copy, 'test', 'hot-entry.ts'), args: [], env: { WERK_FAKE_SCRIPT: script } })
  const before = await liveHello(server.port)
  expect(before.children).toHaveLength(1)
  const child = before.children[0]!
  expect(isAlive(child.pid)).toBe(true)

  appendFileSync(join(copy, 'src', 'server', 'children.ts'), '\n// an edit\n')
  await server.waitFor(REUSE)

  const after = await liveHello(server.port)
  expect(after).toEqual(before)
  expect(isAlive(child.pid)).toBe(true)
  expect(server.output().match(/werk: serving /g)).toHaveLength(1)

  await server.stop()
  server = undefined
  await Bun.sleep(200)
  expect(isAlive(child.pid)).toBe(false)
}, 60_000)

test('the dev command keeps a chat session and its agent child alive through an edit to a server module', async () => {
  copy = copyWerk()
  project = makeProject()
  const calls = join(project.dir, 'calls.jsonl')
  server = await startServe(project.dir, { hot: true, entry: join(copy, 'src', 'cli.ts'), env: { WERK_FAKE_CALLS: calls } })
  const serverPid = server.process.pid!
  expect((await health(server.port)).pid).toBe(serverPid)

  const agent = await chat(server.port, 'before the edit')
  expect(isAlive(agent.pid)).toBe(true)
  const before = await liveHello(server.port)
  expect(before.children).toEqual([{ name: 'chat', pid: agent.pid }])

  appendFileSync(join(copy, 'src', 'server', 'app.ts'), '\n// an edit\n')
  await server.waitFor(/werk: reloaded src\/server\/app\.ts/)
  const reuse = await server.waitFor(REUSE)
  expect(reuse[0]).toBeDefined()
  expect(server.output()).toMatch(/reusing the live server on port \d+ \(pid \d+\); not listening again/)

  expect((await health(server.port)).pid).toBe(serverPid)
  expect(isAlive(agent.pid)).toBe(true)
  expect(await liveHello(server.port)).toEqual(before)
  expect((await chat(server.port, 'after the edit')).pid).toBe(agent.pid)
  expect(server.output().match(/werk: serving /g)).toHaveLength(1)
  expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(1)
}, 60_000)

test('after a hot reload, an append to the log still reaches an open live channel', async () => {
  copy = copyWerk()
  project = makeProject()
  server = await startServe(project.dir, { hot: true, entry: join(copy, 'src', 'cli.ts') })

  appendFileSync(join(copy, 'src', 'server', 'app.ts'), '\n// an edit\n')
  await server.waitFor(REUSE)

  const live = await openLive(server.port)
  try {
    appendFileSync(logPath(project.dir), '\n')
    await live.next('changed')
  } finally {
    live.close()
  }
  expect(server.output().match(/werk: serving /g)).toHaveLength(1)
}, 60_000)
