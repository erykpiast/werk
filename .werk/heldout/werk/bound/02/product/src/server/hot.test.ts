import { afterEach, expect, test } from 'bun:test'
import { appendFileSync, cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WERK_ROOT } from '../../test/env.ts'
import { liveHello, makeProject, startServe, type RunningServer, type TempProject } from '../../test/harness.ts'

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
