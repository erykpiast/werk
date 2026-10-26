/**
 * Held-out steps 101.1 to 101.4: the app runs in dev mode (`bun --hot ... serve`, the dev
 * target) from a copy of werk's code. Each test edits only the harness's app copy.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { cpSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { delta, end, start, whole } from './common.ts'

type Dev = { url: string; dir: string; log: () => string; proc: ChildProcessByStdio<null, Readable, Readable> }

/**
 * Starts the app copy in dev mode on a copy of the harness project. The env is the harness's:
 * the fake agent first on PATH, and the same script and launch record.
 */
async function devServer(werk: Werk, page: Page): Promise<Dev> {
  const root = dirname(werk.dir)
  const dir = join(root, 'dev-project')
  cpSync(werk.dir, dir, { recursive: true })
  // The copy must not carry the harness server's lock.
  rmSync(join(dir, '.werk', 'server.lock'), { force: true })
  const env = {
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
    WERK_FAKE_AGENT_LOG: join(root, 'agent-launches.jsonl'),
    WERK_FAKE_AGENT_INPUT: join(root, 'agent-input.jsonl'),
  }
  const proc = spawn('bun', ['--hot', werk.app.main, 'serve', '--port', '0'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  proc.stderr.on('data', (c: Buffer) => (log += c.toString()))
  const url = await new Promise<string>((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`no address: ${log}`)), 20_000)
    proc.stdout.on('data', (c: Buffer) => {
      out += c.toString()
      log += c.toString()
      const m = out.match(/http:\/\/\S+\//)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    })
  })
  test.info().attach('dev server', { body: url })
  const host = new URL(url).host
  await page.context().route('**/*', (route) => (new URL(route.request().url()).host === host ? route.continue() : route.fallback()))
  return { url, dir, log: () => log, proc }
}

const stopDev = async (dev: Dev) => {
  if (dev.proc.exitCode !== null) return
  const exited = new Promise((r) => dev.proc.once('exit', r))
  dev.proc.kill('SIGKILL')
  await exited
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const edit = (file: string, change: (s: string) => string) => {
  const before = readFileSync(file, 'utf8')
  const after = change(before)
  expect(after).not.toBe(before)
  writeFileSync(file, after)
}

const DRAFT = 'A draft I have not sent yet'

test('101.1 A server edit during a running chat turn keeps the turn alive', async ({ page, werk }) => {
  const gate = join(dirname(werk.dir), 'turn-may-end')
  werk.scriptAgent({
    steps: [],
    roles: { chat: [{ steps: [start, delta('Before the edit.'), { waitFor: gate }, delta(' After the edit.'), whole('Before the edit. After the edit.'), end] }] },
  })
  const dev = await devServer(werk, page)
  try {
    await page.goto(dev.url)
    const composer = page.getByRole('textbox', { name: 'message' })
    await composer.fill('Work through the edit')
    await composer.press('Enter')
    const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
    await expect(replyText).toHaveText('Before the edit.')
    const [child] = werk.agentRuns().map((r) => r.pid)
    expect(child).toBeDefined()
    const lockPath = join(dev.dir, '.werk', 'server.lock')
    const lock = readFileSync(lockPath, 'utf8')
    const lockTime = statSync(lockPath).mtimeMs

    // The agent edits a server module in the app copy.
    edit(join(werk.app.root, 'src', 'server', 'server.ts'), (s) => s.replace('`werk: no route ${path}`', '`werk: no such route ${path}`'))
    await expect.poll(dev.log, { timeout: 20_000 }).toContain('reusing the live server')
    expect(dev.log()).not.toContain('waiting for pid')
    expect(readFileSync(lockPath, 'utf8')).toBe(lock)
    expect(statSync(lockPath).mtimeMs).toBe(lockTime)
    expect(alive(child!)).toBe(true)

    writeFileSync(gate, '')
    await expect(replyText).toHaveText('Before the edit. After the edit.')
    await expect(page.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()
    expect(werk.agentRuns().map((r) => r.pid)).toEqual([child!])
  } finally {
    await stopDev(dev)
  }
})

test('101.2 A page opened after a server edit sees the running turn', async ({ page, werk }) => {
  const gate = join(dirname(werk.dir), 'turn-may-end')
  werk.scriptAgent({
    steps: [],
    roles: { chat: [{ steps: [start, delta('Working.'), { waitFor: gate }, delta(' Done.'), whole('Working. Done.'), end] }] },
  })
  const dev = await devServer(werk, page)
  try {
    await page.goto(dev.url)
    const composer = page.getByRole('textbox', { name: 'message' })
    await composer.fill('Start a long turn')
    await composer.press('Enter')
    await expect(page.getByRole('list', { name: 'transcript' }).getByLabel('reply')).toHaveText('Working.')

    edit(join(werk.app.root, 'src', 'server', 'server.ts'), (s) => s.replace('`werk: no route ${path}`', '`werk: no such route ${path}`'))
    await expect.poll(dev.log, { timeout: 20_000 }).toContain('reusing the live server')

    // The person opens the page in a new tab.
    const tab = await page.context().newPage()
    await tab.goto(dev.url)
    const chat = tab.getByRole('complementary', { name: 'chat' })
    const chip = chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab').first()
    await expect(chip.locator('.dot')).toHaveAttribute('title', 'running')

    writeFileSync(gate, '')
    await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Done.')
  } finally {
    await stopDev(dev)
  }
})

test('101.3 A client change that cannot apply in place keeps the composer draft', async ({ page, werk }) => {
  const dev = await devServer(werk, page)
  try {
    await page.goto(dev.url)
    const composer = page.getByRole('textbox', { name: 'message' })
    await composer.click()
    await composer.pressSequentially(DRAFT)
    await page.evaluate(() => ((window as { beforeTheEdit?: true }).beforeTheEdit = true))
    const reloaded = page.waitForEvent('load')

    edit(join(werk.app.root, 'web', 'src', 'main.tsx'), (s) => `${s}\ndocument.documentElement.dataset.heldout = 'changed'\n`)

    await reloaded
    expect(await page.evaluate(() => (window as { beforeTheEdit?: true }).beforeTheEdit)).toBeUndefined()
    await expect(composer).toHaveValue(DRAFT)
    await expect(page.locator('html')).toHaveAttribute('data-heldout', 'changed')
  } finally {
    await stopDev(dev)
  }
})

test('101.4 A client change that applies in place reaches the page without a reload', async ({ page, werk }) => {
  const dev = await devServer(werk, page)
  try {
    await page.goto(dev.url)
    const composer = page.getByRole('textbox', { name: 'message' })
    await composer.click()
    await composer.pressSequentially(DRAFT)
    await page.evaluate(() => ((window as { beforeTheEdit?: true }).beforeTheEdit = true))
    let loads = 0
    page.on('load', () => loads++)

    edit(join(werk.app.root, 'web', 'app.css'), (s) => s.replace('.chat textarea {\n', '.chat textarea {\n  background-color: rgb(1, 2, 3);\n'))

    await expect(composer).toHaveCSS('background-color', 'rgb(1, 2, 3)')
    expect(await page.evaluate(() => (window as { beforeTheEdit?: true }).beforeTheEdit)).toBe(true)
    expect(loads).toBe(0)
    await expect(composer).toHaveValue(DRAFT)
  } finally {
    await stopDev(dev)
  }
})
