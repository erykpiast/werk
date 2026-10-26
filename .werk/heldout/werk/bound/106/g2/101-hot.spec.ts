import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test } from './dev.ts'

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const start = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string) => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const gatedReply = (gate: string): FakeReply => ({
  steps: [
    start,
    delta('Before the edit.'),
    { waitFor: gate },
    delta(' After the edit.'),
    { event: { type: 'assistant', message: { content: [{ type: 'text', text: 'Before the edit. After the edit.' }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } },
  ],
})
const editServer = (root: string) => {
  const f = join(root, 'src', 'server', 'server.ts')
  writeFileSync(f, readFileSync(f, 'utf8') + '\n// An edit by the agent.\n')
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('101.1 a server edit during a running chat turn keeps the turn alive', async ({ page, dev }) => {
  const gate = join(dev.root, 'gate')
  dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  await page.goto(dev.url)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Work through the edit')
  await composer.press('Enter')
  const transcript = page.getByRole('list', { name: 'transcript' })
  await expect(transcript).toContainText('Before the edit.')
  const chat = dev.launches().filter((l) => l.role === 'chat')
  expect(chat).toHaveLength(1)
  const pid = chat[0]!.pid
  const lockPath = join(dev.dir, '.werk', 'server.lock')
  const lock = readFileSync(lockPath, 'utf8')
  const lockTime = statSync(lockPath).mtimeMs

  editServer(dev.app.root)
  await expect.poll(dev.stderr, { timeout: 15_000 }).toContain('reusing the live server')
  expect(dev.stderr()).not.toContain('waiting for pid')
  expect(dev.stderr()).not.toContain('another werk is already serving')
  expect(readFileSync(lockPath, 'utf8')).toBe(lock)
  expect(statSync(lockPath).mtimeMs).toBe(lockTime)
  expect(alive(pid)).toBe(true)
  expect(dev.launches().map((l) => l.pid)).toEqual([pid])

  writeFileSync(gate, '')
  await expect(transcript.getByLabel('reply')).toHaveText('Before the edit. After the edit.')
  expect(dev.launches().map((l) => l.pid)).toEqual([pid])
})

test('101.2 a page opened after a server edit sees the running turn', async ({ page, dev, context }) => {
  const gate = join(dev.root, 'gate')
  dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  await page.goto(dev.url)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Run while I edit')
  await composer.press('Enter')
  await expect(page.getByRole('list', { name: 'transcript' })).toContainText('Before the edit.')

  editServer(dev.app.root)
  await expect.poll(dev.stderr, { timeout: 15_000 }).toContain('reusing the live server')

  const second = await context.newPage()
  await second.goto(dev.url)
  const tab = second.getByRole('tablist', { name: 'conversations' }).getByRole('tab').first()
  await expect(tab).toHaveAttribute('data-state', 'running')
  expect(existsSync(gate)).toBe(false)
  writeFileSync(gate, '')
  await expect(second.getByRole('list', { name: 'transcript' }).getByLabel('reply')).toHaveText('Before the edit. After the edit.')
})

const DRAFT = 'A draft I have not sent'

test('101.3 a client change that cannot apply in place keeps the composer draft', async ({ page, dev }) => {
  await page.goto(dev.url)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill(DRAFT)
  await page.evaluate(() => ((window as { marker?: true }).marker = true))
  const loaded = page.waitForEvent('load', { timeout: 20_000 })
  const main = join(dev.app.root, 'web', 'src', 'main.tsx')
  writeFileSync(main, readFileSync(main, 'utf8') + `\ndocument.documentElement.dataset.heldout = 'changed'\n`)
  await loaded
  expect(await page.evaluate(() => (window as { marker?: true }).marker)).toBeUndefined()
  await expect(composer).toHaveValue(DRAFT)
  await expect(page.locator('html')).toHaveAttribute('data-heldout', 'changed')
})

test('101.4 a client style change applies in place without a reload', async ({ page, dev }) => {
  await page.goto(dev.url)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill(DRAFT)
  await page.evaluate(() => ((window as { marker?: true }).marker = true))
  let loads = 0
  page.on('load', () => loads++)
  const css = join(dev.app.root, 'web', 'app.css')
  writeFileSync(css, readFileSync(css, 'utf8') + '\nbody { outline: 7px solid rgb(1, 2, 3); }\n')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).outlineColor), { timeout: 15_000 }).toBe('rgb(1, 2, 3)')
  expect(loads).toBe(0)
  expect(await page.evaluate(() => (window as { marker?: true }).marker)).toBe(true)
  await expect(composer).toHaveValue(DRAFT)
})
