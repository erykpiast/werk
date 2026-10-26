/** Steps 69.1 to 69.4: the map in a browser, against a real werk server. */
import { test, expect, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const ROOT = process.env.WERK_ROOT ?? join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')

type Server = ChildProcessByStdio<null, Readable, Readable> & { out: string; err: string }

const ev = (seq: number, e: object) => JSON.stringify({ seq, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e })
const card = (id: string, title: string, parent?: string) => ({
  type: 'node.proposed',
  payload: { id, kind: 'card', title, ...(parent && { parent }) },
})
const acc = (id: string) => ({ type: 'node.accepted', payload: { id }, actor: 'you' })

/** A root, two children that refine it, and one grandchild under the first child. All real. */
const FIXTURE = [
  card('root', 'The root card'),
  card('child-a', 'Child card A', 'root'),
  card('child-b', 'Child card B', 'root'),
  card('grandchild', 'Grandchild card', 'child-a'),
  acc('root'),
  acc('child-a'),
  acc('child-b'),
  acc('grandchild'),
]

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'werk-ho-e2e-'))
  const dir = join(root, 'project')
  mkdirSync(join(dir, '.werk'), { recursive: true })
  writeFileSync(join(dir, '.werk', 'log.jsonl'), FIXTURE.map((e, i) => ev(i + 1, e)).join('\n') + '\n')
  const env = { PATH: process.env.PATH ?? '', HOME: root, TMPDIR: tmpdir() }
  const cli = (args: string[]) => {
    const r = spawnSync('bun', [MAIN, ...args], { cwd: dir, env, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
    return r.stdout
  }
  const serve = (): Server => {
    const s = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] }) as Server
    s.out = ''
    s.err = ''
    s.stdout.on('data', (c: Buffer) => (s.out += c.toString()))
    s.stderr.on('data', (c: Buffer) => (s.err += c.toString()))
    return s
  }
  return { root, dir, cli, serve, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function urlOf(s: Server): Promise<string> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const m = s.out.match(/http:\/\/\S+\//)
    if (m) return m[0]
    if (s.exitCode !== null) throw new Error(`serve exited ${s.exitCode}: ${s.err}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`serve printed no address: ${s.err}`)
}

async function stop(s: Server) {
  if (s.exitCode !== null || s.signalCode !== null) return
  const exited = new Promise((r) => s.once('exit', r))
  s.kill('SIGTERM')
  const t = setTimeout(() => s.kill('SIGKILL'), 5000)
  await exited
  clearTimeout(t)
}

let proj: ReturnType<typeof makeProject>
let server: Server
let url: string

test.beforeEach(async ({ page }) => {
  proj = makeProject()
  server = proj.serve()
  url = await urlOf(server)
  await page.goto(url)
})

test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('evidence.png'), fullPage: true }).catch(() => {})
  await stop(server)
  proj.cleanup()
})

const li = (page: Page, id: string) => page.locator(`li[data-card-id="${id}"]`)

test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('> li[data-card-id="root"]')).toContainText('The root card')
  await expect(map.locator('> li[data-card-id="root"] > ul > li[data-card-id="child-a"]')).toContainText('Child card A')
  await expect(map.locator('> li[data-card-id="root"] > ul > li[data-card-id="child-b"]')).toContainText('Child card B')
  await expect(li(page, 'child-a').locator('> ul > li[data-card-id="grandchild"]')).toContainText('Grandchild card')
  await expect(map.locator('> li[data-card-id="root"] > ul > li[data-card-id="grandchild"]')).toHaveCount(0)
  await expect(page.getByText('Grandchild card')).toBeVisible()
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page }) => {
  await expect(li(page, 'root')).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  proj.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root'])
  proj.cli(['accept', 'append-log', '--actor', 'you'])
  await expect(page.locator('li[data-card-id="root"] > ul > li[data-card-id="append-log"]')).toContainText(
    'Use an append-only log',
    { timeout: 5000 },
  )
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await li(page, 'child-b').locator('> a').click()
  await expect(page).toHaveURL(/child-b/)
  const detail = page.getByTestId('card')
  await expect(detail).toContainText('Child card B')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/child-b/)
  await expect(page.getByTestId('card')).toContainText('Child card B')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page }) => {
  await expect(li(page, 'child-a')).toBeVisible()
  const firstPid = server.pid!
  const second = proj.serve()
  const started = Date.now()
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => resolve(-999), 9000)
    second.once('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const took = Date.now() - started
  await stop(second)
  expect(second.err).toMatch(new RegExp(`wait\\w* for pid ${firstPid}\\b`))
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  const lines = second.err.split('\n')
  const errLine = lines.find((l) => !/waiting/.test(l) && l.includes(String(firstPid)))
  expect(errLine, second.err).toBeDefined()
  await page.goto(url)
  for (const id of ['root', 'child-a', 'child-b', 'grandchild']) await expect(li(page, id)).toBeVisible()
})
