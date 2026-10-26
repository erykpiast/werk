// #werk-projects behaviours through a real `werk serve`: one server, several projects, each
// with its own map and its own agents. No WERK_LOG here: each project finds its own map.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { scratchDir, waitFor } from './test/harness.ts'

const PORT = 4944
const url = `http://localhost:${PORT}`
const CLI = join(import.meta.dir, 'cli.ts')
let dir: string
let env: Record<string, string | undefined>
let proc: import('bun').Subprocess
let out = ''

function folder(name: string, git = true): string {
  const root = join(dir, name)
  mkdirSync(root, { recursive: true })
  if (git) Bun.spawnSync(['git', 'init', '-q'], { cwd: root })
  return root
}

const post = async (path: string, body: unknown) => {
  const r = await fetch(url + path, { method: 'POST', body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
const listed = async () => (await (await fetch(`${url}/api/projects`)).json()).projects as Array<{ name: string; root: string; running: string[] }>
const titles = async (name: string) => (await (await fetch(`${url}/p/${name}/api/graph`)).json()).nodes.map((n: { title: string }) => n.title)
const werk = (cwd: string, ...args: string[]) => Bun.spawnSync(['bun', CLI, ...args], { cwd, env })

beforeAll(async () => {
  dir = scratchDir('werk-projects-serve-')
  env = { ...process.env, WERK_CONFIG_DIR: join(dir, 'config'), FAKE_CLAUDE_MODE: 'hang', FAKE_CLAUDE_LOG: join(dir, 'fake.jsonl') }
  delete env.WERK_LOG
  delete env.WERK_BOARD
  delete env.WERK_PIPELINE
  proc = Bun.spawn(['bun', CLI, 'serve', '--port', String(PORT)], { cwd: folder('alpha'), env, stdout: 'pipe', stderr: 'pipe' })
  for (const stream of [proc.stdout, proc.stderr] as ReadableStream<Uint8Array>[]) {
    void (async () => {
      for await (const chunk of stream) out += new TextDecoder().decode(chunk)
    })()
  }
  await waitFor(() => out.includes(`werk map on ${url}`) || proc.exitCode !== null, 'the server to listen', 10000)
})

afterAll(async () => {
  proc.kill('SIGTERM')
  await proc.exited
})

describe('projects in one server', () => {
  test('the folder werk starts in is on the list at once', async () => {
    expect((await listed()).map((p) => p.name)).toEqual(['alpha'])
  })

  test('two projects keep their own maps', async () => {
    const beta = folder('beta')
    expect((await post('/api/projects/add', { root: beta })).body.ok).toBe(true)
    werk(join(dir, 'alpha'), 'add', 'root', '--title', 'Alpha', '--no-basis')
    werk(beta, 'add', 'root', '--title', 'Beta', '--no-basis')
    expect(await titles('alpha')).toEqual(['Alpha'])
    expect(await titles('beta')).toEqual(['Beta'])
  })

  test('an unknown project has no /api, and its page still loads to say so', async () => {
    expect((await fetch(`${url}/p/nope/api/graph`)).status).toBe(404)
    expect(await (await fetch(`${url}/p/nope/map`)).text()).toContain('<html')
  })

  test('a folder with no git repository is added only after the person agrees to git init', async () => {
    const plain = folder('plain', false)
    const refused = await post('/api/projects/add', { root: plain })
    expect(refused.status).toBe(409)
    expect(refused.body.needsGit).toBe(true)
    expect(existsSync(join(plain, '.werk'))).toBe(false)
    expect((await post('/api/projects/add', { root: plain, init: true })).body.ok).toBe(true)
    expect(existsSync(join(plain, '.git'))).toBe(true)
  })

  test('remove names a running turn, and stops it and removes the project only when confirmed', async () => {
    const gamma = folder('gamma')
    await post('/api/projects/add', { root: gamma })
    expect((await post('/p/gamma/api/chat', { text: 'hello', card: 'root' })).status).toBe(200)
    for (let i = 0; !(await listed()).find((p) => p.name === 'gamma')?.running.length; i++) {
      if (i > 100) throw new Error('timed out waiting for the turn to run')
      await Bun.sleep(50)
    }
    const asked = await post('/api/projects/remove', { name: 'gamma' })
    expect(asked.status).toBe(409)
    expect(asked.body.running).toEqual(['main'])
    expect((await listed()).map((p) => p.name)).toContain('gamma')
    expect((await post('/api/projects/remove', { name: 'gamma', force: true })).body.ok).toBe(true)
    expect((await listed()).map((p) => p.name)).not.toContain('gamma')
    expect(existsSync(join(gamma, '.werk'))).toBe(true)
  })

  test('starting werk in another folder while werk runs adds that folder to it, and exits', async () => {
    const delta = folder('delta')
    const r = Bun.spawnSync(['bun', CLI, 'serve', '--port', String(PORT)], { cwd: delta, env })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toString()).toContain(`${url}/p/delta/map`)
    expect((await listed()).map((p) => p.name)).toContain('delta')
  })
})
