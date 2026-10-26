/** 01.1, 32.1, 32.4, 32.5: the served page, the live channel, and the dev reload. */
import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '../../e2e/fixtures.ts'
import { copyApp } from '../../src/test/app-copy.ts'

const REPO = join(import.meta.dirname, '..', '..')
const FAKE_BIN = join(REPO, 'src', 'test', 'fake-claude', 'bin')

interface Served {
  url: string
  output: () => string
  child: ChildProcess
}
function serve(cmd: string, args: string[], cwd: string): Promise<Served> {
  const { WERK_LOG: _, ...env } = process.env
  const child = spawn(cmd, args, {
    cwd,
    env: { ...env, PATH: `${FAKE_BIN}:${process.env.PATH ?? ''}`, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let out = ''
  child.stdout?.on('data', (c: Buffer) => (out += c.toString()))
  child.stderr?.on('data', (c: Buffer) => (out += c.toString()))
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const m = out.match(/werk: serving (http:\/\/\S+)/)
      if (m) {
        clearInterval(timer)
        resolve({ url: m[1] as string, output: () => out, child })
      }
    }, 20)
    child.once('exit', (code) => {
      clearInterval(timer)
      reject(new Error(`exited ${code}: ${out}`))
    })
  })
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((r) => child.once('exit', r))
  process.kill(-(child.pid as number), 'SIGTERM')
  await exited
}

/** A reader of the live channel from outside the page. */
async function liveEvents(url: string) {
  const abort = new AbortController()
  const res = await fetch(`${url}/api/live`, { signal: abort.signal })
  const events: string[] = []
  void (async () => {
    const dec = new TextDecoder()
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        for (const m of dec.decode(chunk).matchAll(/^event: (\S+)/gm)) events.push(m[1] as string)
      }
    } catch {}
  })()
  return { events, close: () => abort.abort() }
}

test('01.1 werk serve in an empty project shows the empty map shell', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-'))
  const project = join(root, 'project')
  mkdirSync(project)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  const s = await serve('bun', [join(REPO, 'src', 'cli.ts'), 'serve', '--port', '0'], project)
  try {
    await page.goto(s.url)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('werk')
    // React rendered the page: the root element is a React container.
    expect(await page.evaluate(() => Object.keys(document.getElementById('root') ?? {}).some((k) => k.startsWith('__reactContainer')))).toBe(true)
    const map = page.getByRole('region', { name: 'Map' })
    await expect(map).toContainText('No cards yet.')
    await expect(map.getByRole('link')).toHaveCount(0)
    await expect(page.locator('main')).toHaveAttribute('data-live', 'open')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
    expect(s.output()).not.toMatch(/error/i)
  } finally {
    await stop(s.child)
    rmSync(root, { recursive: true, force: true })
  }
})

test('32.1 the served page shows the empty map and the composer', async ({ page, werk }) => {
  await page.goto(werk.url)
  expect(await page.evaluate(() => Object.keys(document.getElementById('root') ?? {}).some((k) => k.startsWith('__reactContainer')))).toBe(true)
  await expect(page.getByRole('region', { name: 'Map' })).toContainText('No cards yet.')
  const box = page.getByRole('form', { name: 'Composer' }).getByRole('textbox')
  await box.fill('hello there')
  await expect(box).toHaveValue('hello there')
})

test('32.4 a change to the log reaches an open page without a manual refresh', async ({ page, werk }) => {
  await page.goto(werk.url)
  await expect(page.locator('main')).toHaveAttribute('data-live', 'open')
  await page.evaluate(() => Object.assign(window, { heldoutMark: true }))
  const outside = await liveEvents(werk.url)
  await expect.poll(() => outside.events).toContain('hello')
  const refetch = page.waitForRequest((r) => r.url().includes('/api/view'))
  appendFileSync(
    join(werk.project, '.werk', 'log.jsonl'),
    `${JSON.stringify({ seq: 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type: 'node.added', payload: { id: 'x', kind: 'card', title: 'A new card' } })}\n`,
  )
  await expect.poll(() => outside.events).toContain('changed')
  await refetch
  await expect(page.getByRole('region', { name: 'Map' })).toContainText('A new card')
  expect(await page.evaluate(() => 'heldoutMark' in window)).toBe(true)
  outside.close()
})

test('32.5 a client change that cannot apply in place reloads the page and keeps the draft (npm run dev)', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'werk-heldout-dev-'))
  const app = copyApp(join(root, 'app'))
  cpSync(join(REPO, 'e2e', 'fixtures', 'project', '.werk'), join(app.dir, '.werk'), { recursive: true })
  const s = await serve('npm', ['run', 'dev', '--', '--port', '0'], app.dir)
  try {
    await page.goto(s.url)
    await expect(page.locator('main')).toHaveAttribute('data-live', 'open')
    const box = page.getByRole('textbox', { name: 'Message' })
    await box.fill('my half-typed draft')
    await page.evaluate(() => Object.assign(window, { heldoutMark: true }))
    const outside = await liveEvents(s.url)
    await expect.poll(() => outside.events).toContain('hello')
    app.edit('web/main.tsx', (t) => `${t}\n// an edit\n`)
    await expect.poll(() => outside.events, { timeout: 20_000 }).toContain('reload')
    await page.waitForFunction(() => !('heldoutMark' in window))
    await expect(page.locator('main')).toHaveAttribute('data-live', 'open')
    await expect(box).toHaveValue('my half-typed draft')
    outside.close()
  } finally {
    await stop(s.child)
    rmSync(root, { recursive: true, force: true })
  }
})
