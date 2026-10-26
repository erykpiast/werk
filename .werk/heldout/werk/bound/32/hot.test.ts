/** 01.2 and 32.3: the dev command, an edit to a server module, and a long-lived child. */
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(120_000)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyApp, type AppCopy } from '../src/test/app-copy.ts'
import { makeProject, type Project } from '../src/test/cli-harness.ts'
import { openLive } from '../src/test/live-client.ts'
import { isAlive } from '../src/server/lock.ts'

let project: Project
let root: string
let app: AppCopy
let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
let out = ''

beforeEach(async () => {
  project = await makeProject()
  root = mkdtempSync(join(tmpdir(), 'werk-heldout-app-'))
  app = copyApp(join(root, 'app'))
  out = ''
})
afterEach(async () => {
  child?.kill('SIGTERM')
  await child?.exited
  child = undefined
  project.cleanup()
  rmSync(root, { recursive: true, force: true })
})

/** Runs the dev script of the app copy, as `npm run dev`, with the project as working directory. */
function startDev(cmd: string[], cwd: string) {
  child = Bun.spawn(cmd, { cwd, env: { ...project.env, HOME: process.env.HOME ?? '' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  for (const s of [child.stdout, child.stderr]) {
    void (async () => {
      for await (const c of s) out += new TextDecoder().decode(c)
    })()
  }
}
async function waitFor(re: RegExp, ms = 20_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const m = out.match(re)
    if (m) return m
    await Bun.sleep(20)
  }
  throw new Error(`no ${re} in:\n${out}`)
}
const state = async (url: string) => (await (await fetch(`${url}/api/state`)).json()) as {
  pid: number
  children: number[]
  instance: string
}
const pidOn = (port: string) =>
  Bun.spawnSync(['lsof', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).stdout.toString().trim().split('\n').map(Number)

async function scenario(cmd: string[]) {
  const pkg = JSON.parse(readFileSync(join(app.dir, 'package.json'), 'utf8'))
  expect(pkg.scripts.dev).toContain('--hot')
  // The project of the dev command is the app copy: npm runs the script in the package folder.
  startDev(cmd, app.dir)
  const url = (await waitFor(/werk: serving (http:\/\/\S+)/))[1] as string
  const port = new URL(url).port
  const serverPid = pidOn(port)[0] as number
  const before = await state(url)
  expect(before.pid).toBe(serverPid)
  return { url, port, serverPid, before }
}

async function afterEdit(url: string, port: string, serverPid: number, before: Awaited<ReturnType<typeof state>>) {
  app.edit('src/server/routes.ts', (t) => `${t}\n// an edit\n`)
  await waitFor(/hot reload, reusing the live server/)
  expect(out.match(/werk: serving/g)).toHaveLength(1)
  expect(pidOn(port)).toEqual([serverPid])
  const after = await state(url)
  expect(after.pid).toBe(serverPid)
  const live = await openLive(url)
  expect(await live.next('hello')).toEqual(before)
  live.close()
  return after
}

test('01.2 an agent edits a server module while a live session runs', async () => {
  const { url, port, serverPid, before } = await scenario(['npm', 'run', 'dev', '--', '--port', '0'])
  await afterEdit(url, port, serverPid, before)
  // "A long-lived agent child is running from a chat session that started before the edit."
  expect(before.children.length).toBeGreaterThan(0)
})

test('32.3 an edit to a server module reloads it in the same process, and a live child survives', async () => {
  const { url, port, serverPid, before } = await scenario(['npm', 'run', 'dev', '--', '--port', '0'])
  const after = await afterEdit(url, port, serverPid, before)
  // "The server has started a long-lived child before any edit."
  expect(before.children.length).toBeGreaterThan(0)
  for (const c of before.children) expect(isAlive(c)).toBe(true)
  expect(after.children).toEqual(before.children)
})
