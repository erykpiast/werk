/** Held-out steps 69.1 to 69.4, in a real browser against a real werk server. */
import { test as base, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const ROOT = join(import.meta.dirname, '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
type Server = ChildProcessByStdio<null, Readable, Readable>

type Werk = { url: string; dir: string; pid: number; cli: (args: string[]) => void; env: Record<string, string> }

function start(dir: string, env: Record<string, string>): { server: Server; out: () => string; err: () => string } {
  const server = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  server.stdout.on('data', (c: Buffer) => (out += c.toString()))
  server.stderr.on('data', (c: Buffer) => (err += c.toString()))
  return { server, out: () => out, err: () => err }
}

async function addressOf(s: ReturnType<typeof start>): Promise<string> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const m = s.out().match(/http:\/\/\S+\//)
    if (m) return m[0]
    if (s.server.exitCode !== null) throw new Error(`serve exited: ${s.err()}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('no address')
}

async function stop(server: Server) {
  if (server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise((r) => server.once('exit', r))
  server.kill('SIGTERM')
  await exited
}

const test = base.extend<{ werk: Werk }>({
  werk: [async ({ page }, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'werk-heldout-'))
    const dir = join(root, 'project')
    mkdirSync(dir)
    const env = { PATH: process.env.PATH ?? '', HOME: root, TMPDIR: tmpdir() }
    const cli = (args: string[]) => {
      const r = spawnSync('bun', [MAIN, ...args], { cwd: dir, env, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`werk ${args.join(' ')}: ${r.stderr}`)
    }
    const card = (id: string, title: string, parent?: string) => {
      cli(['add', id, '--title', title, ...(parent ? ['--parent', parent] : [])])
      cli(['accept', id, '--actor', 'you'])
    }
    card('root', 'The root card')
    card('child-a', 'First child', 'root')
    card('child-b', 'Second child', 'root')
    card('grandchild', 'The grandchild', 'child-a')
    const s = start(dir, env)
    try {
      const url = await addressOf(s)
      await page.goto(url)
      try {
        await use({ url, dir, pid: s.server.pid!, cli, env })
      } finally {
        await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true }).catch(() => {})
      }
    } finally {
      await stop(s.server)
      rmSync(root, { recursive: true, force: true })
    }
  }, { auto: true }],
})

const li = (id: string) => `li[data-card-id="${id}"]`

test('69.1 the map shows the project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${li('root')}`)).toContainText('The root card')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-a')}`)).toContainText('First child')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-b')}`)).toContainText('Second child')
  await expect(map.locator(`> ${li('root')} > ul > ${li('child-a')} > ul > ${li('grandchild')}`)).toContainText('The grandchild')
  await expect(map.locator(`> ${li('root')} > ul > ${li('grandchild')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(li('root'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutMarker: true }))
  werk.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root'])
  werk.cli(['accept', 'append-log', '--actor', 'you'])
  await expect(page.locator(`${li('root')} > ul > ${li('append-log')}`)).toContainText('Use an append-only log', { timeout: 5_000 })
  expect(await page.evaluate(() => (window as { heldoutMarker?: boolean }).heldoutMarker)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${li('child-b')} > a`).click()
  await expect(page).toHaveURL(/child-b/)
  const detail = page.getByTestId('card')
  await expect(detail).toContainText('Second child')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/child-b/)
  await expect(page.getByTestId('card')).toContainText('Second child')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li')).toHaveCount(4)
  const t0 = Date.now()
  const second = start(werk.dir, werk.env)
  await expect.poll(() => second.err(), { timeout: 3_000 }).toContain(`waiting for pid ${werk.pid}`)
  const code = await new Promise<number | null>((resolve) => {
    if (second.server.exitCode !== null) return resolve(second.server.exitCode)
    const t = setTimeout(() => {
      second.server.kill('SIGKILL')
      resolve(null)
    }, 10_000)
    second.server.once('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const elapsed = Date.now() - t0
  expect(code).not.toBeNull()
  expect(code).not.toBe(0)
  expect(elapsed).toBeLessThan(7_500)
  const lines = second.err().split('\n').filter((l) => !l.includes('waiting for pid'))
  expect(lines.join('\n')).toContain(String(werk.pid))
  await page.goto(werk.url)
  await expect(map.locator('li')).toHaveCount(4)
  await expect(map.locator(li('grandchild'))).toBeVisible()
})
