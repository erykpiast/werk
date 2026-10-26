/** Steps 101.1-101.4: the app runs in dev mode (bun --hot) from a copy of werk's code. */
import { test as base, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { makeDev, type Dev, type DevServer } from './devfixture.ts'

const test = base.extend<{ dev: Dev; server: DevServer }>({
  dev: async ({}, use) => {
    const dev = makeDev()
    try {
      await use(dev)
    } finally {
      await dev.cleanup()
    }
  },
  server: async ({ dev }, use) => use(await dev.start({ hot: true })),
})
test.setTimeout(90_000)

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const gatedReply = (gate: string): FakeReply => ({
  steps: [
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Working on it.' } }),
    { waitFor: gate },
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' Done now.' } }),
    { event: { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it. Done now.' }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } },
  ],
})
const edit = (file: string, change: (s: string) => string) => writeFileSync(file, change(readFileSync(file, 'utf8')))
/** The edit an agent makes to a server module of the app copy. */
const editServerModule = (dev: Dev) =>
  edit(join(dev.app.root, 'src', 'server', 'server.ts'), (s) => s.replace('`werk: no route ${path}`', '`werk: no such route ${path}`'))
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const DRAFT = 'A draft I have not sent yet'

test('101.1 a server edit during a running chat turn keeps the turn alive', async ({ page, dev, server }) => {
  const gate = join(dev.dir, '..', 'gate-101-1')
  dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  await page.goto(`${server.url}#map`)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Edit the server')
  await composer.press('Enter')
  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toHaveText('Working on it.')
  const [child] = dev.launches().map((l) => l.pid)
  expect(child).toBeDefined()

  editServerModule(dev)
  await expect.poll(() => server.stderr(), { timeout: 20_000 }).toContain('reusing the live server')
  expect(server.stderr()).not.toContain('waiting for pid')
  expect(server.stderr()).not.toContain('another werk is already serving')
  expect(alive(child!)).toBe(true)
  expect(dev.launches().map((l) => l.pid)).toEqual([child])

  writeFileSync(gate, '')
  await expect(replyText).toHaveText('Working on it. Done now.')
  expect(dev.launches().map((l) => l.pid)).toEqual([child])
})

test('101.2 a page opened after a server edit sees the running turn', async ({ page, dev, server }) => {
  const gate = join(dev.dir, '..', 'gate-101-2')
  dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  await page.goto(`${server.url}#map`)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Keep running')
  await composer.press('Enter')
  await expect(page.getByRole('list', { name: 'transcript' }).getByLabel('reply')).toHaveText('Working on it.')
  editServerModule(dev)
  await expect.poll(() => server.stderr(), { timeout: 20_000 }).toContain('reusing the live server')

  const second = await page.context().newPage()
  await second.goto(`${server.url}#map`)
  const chat = second.getByRole('complementary', { name: 'chat' })
  // The new tab shows the turn as running.
  await expect.soft(chat.getByRole('tab').first(), 'the new tab shows the turn as running').toHaveAttribute('data-state', 'running')
  writeFileSync(gate, '')
  await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Done now.')
})

test('101.3 a client change that cannot apply in place keeps the composer draft', async ({ page, dev, server }) => {
  await page.goto(`${server.url}#map`)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill(DRAFT)
  await page.evaluate(() => ((window as { beforeTheEdit?: true }).beforeTheEdit = true))
  const reloaded = page.waitForEvent('load')
  edit(join(dev.app.root, 'web', 'src', 'main.tsx'), (s) => `${s}\ndocument.documentElement.dataset.heldout = 'changed'\n`)
  await reloaded
  expect(await page.evaluate(() => (window as { beforeTheEdit?: true }).beforeTheEdit)).toBeUndefined()
  await expect(composer).toHaveValue(DRAFT)
  await expect(page.locator('html')).toHaveAttribute('data-heldout', 'changed')
})

test('101.4 a client change that applies in place reaches the page without a reload', async ({ page, dev, server }) => {
  await page.goto(`${server.url}#map`)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill(DRAFT)
  await page.evaluate(() => ((window as { beforeTheEdit?: true }).beforeTheEdit = true))
  let loads = 0
  page.on('load', () => loads++)
  const css = join(dev.app.root, 'web', 'app.css')
  expect(existsSync(css)).toBe(true)
  edit(css, (s) => `${s}\nbody { outline: 7px solid rgb(1, 2, 3); }\n`)
  await expect(page.locator('body')).toHaveCSS('outline-color', 'rgb(1, 2, 3)', { timeout: 15_000 })
  expect(await page.evaluate(() => (window as { beforeTheEdit?: true }).beforeTheEdit)).toBe(true)
  expect(loads).toBe(0)
  await expect(composer).toHaveValue(DRAFT)
})
