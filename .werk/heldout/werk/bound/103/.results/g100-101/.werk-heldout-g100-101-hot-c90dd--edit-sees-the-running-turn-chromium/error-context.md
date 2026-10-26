# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g100-101/hot.spec.ts >> 101.2 a page opened after a server edit sees the running turn
- Location: .werk-heldout/g100-101/hot.spec.ts:70:1

# Error details

```
Error: the new tab shows the turn as running

expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('complementary', { name: 'chat' }).getByRole('tab').first()
Expected: "running"
Received: "idle"
Timeout:  5000ms

Call log:
  - the new tab shows the turn as running getByRole('complementary', { name: 'chat' }).getByRole('tab').first() with timeout 5000ms
  - waiting for getByRole('complementary', { name: 'chat' }).getByRole('tab').first()
    14 × locator resolved to <button role="tab" class="tab" type="button" data-tab="main" data-state="idle" aria-selected="true">…</button>
       - unexpected value "idle"

```

```yaml
- tab "#map" [selected]
```

# Test source

```ts
  1   | /** Steps 101.1-101.4: the app runs in dev mode (bun --hot) from a copy of werk's code. */
  2   | import { test as base, expect } from '@playwright/test'
  3   | import { existsSync, readFileSync, writeFileSync } from 'node:fs'
  4   | import { join } from 'node:path'
  5   | import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
  6   | import { makeDev, type Dev, type DevServer } from './devfixture.ts'
  7   | 
  8   | const test = base.extend<{ dev: Dev; server: DevServer }>({
  9   |   dev: async ({}, use) => {
  10  |     const dev = makeDev()
  11  |     try {
  12  |       await use(dev)
  13  |     } finally {
  14  |       await dev.cleanup()
  15  |     }
  16  |   },
  17  |   server: async ({ dev }, use) => use(await dev.start({ hot: true })),
  18  | })
  19  | test.setTimeout(90_000)
  20  | 
  21  | const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
  22  | const gatedReply = (gate: string): FakeReply => ({
  23  |   steps: [
  24  |     stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  25  |     stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Working on it.' } }),
  26  |     { waitFor: gate },
  27  |     stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' Done now.' } }),
  28  |     { event: { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it. Done now.' }] } } },
  29  |     { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } },
  30  |   ],
  31  | })
  32  | const edit = (file: string, change: (s: string) => string) => writeFileSync(file, change(readFileSync(file, 'utf8')))
  33  | /** The edit an agent makes to a server module of the app copy. */
  34  | const editServerModule = (dev: Dev) =>
  35  |   edit(join(dev.app.root, 'src', 'server', 'server.ts'), (s) => s.replace('`werk: no route ${path}`', '`werk: no such route ${path}`'))
  36  | const alive = (pid: number) => {
  37  |   try {
  38  |     process.kill(pid, 0)
  39  |     return true
  40  |   } catch {
  41  |     return false
  42  |   }
  43  | }
  44  | const DRAFT = 'A draft I have not sent yet'
  45  | 
  46  | test('101.1 a server edit during a running chat turn keeps the turn alive', async ({ page, dev, server }) => {
  47  |   const gate = join(dev.dir, '..', 'gate-101-1')
  48  |   dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  49  |   await page.goto(`${server.url}#map`)
  50  |   const composer = page.getByRole('textbox', { name: 'message' })
  51  |   await composer.fill('Edit the server')
  52  |   await composer.press('Enter')
  53  |   const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  54  |   await expect(replyText).toHaveText('Working on it.')
  55  |   const [child] = dev.launches().map((l) => l.pid)
  56  |   expect(child).toBeDefined()
  57  | 
  58  |   editServerModule(dev)
  59  |   await expect.poll(() => server.stderr(), { timeout: 20_000 }).toContain('reusing the live server')
  60  |   expect(server.stderr()).not.toContain('waiting for pid')
  61  |   expect(server.stderr()).not.toContain('another werk is already serving')
  62  |   expect(alive(child!)).toBe(true)
  63  |   expect(dev.launches().map((l) => l.pid)).toEqual([child])
  64  | 
  65  |   writeFileSync(gate, '')
  66  |   await expect(replyText).toHaveText('Working on it. Done now.')
  67  |   expect(dev.launches().map((l) => l.pid)).toEqual([child])
  68  | })
  69  | 
  70  | test('101.2 a page opened after a server edit sees the running turn', async ({ page, dev, server }) => {
  71  |   const gate = join(dev.dir, '..', 'gate-101-2')
  72  |   dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  73  |   await page.goto(`${server.url}#map`)
  74  |   const composer = page.getByRole('textbox', { name: 'message' })
  75  |   await composer.fill('Keep running')
  76  |   await composer.press('Enter')
  77  |   await expect(page.getByRole('list', { name: 'transcript' }).getByLabel('reply')).toHaveText('Working on it.')
  78  |   editServerModule(dev)
  79  |   await expect.poll(() => server.stderr(), { timeout: 20_000 }).toContain('reusing the live server')
  80  | 
  81  |   const second = await page.context().newPage()
  82  |   await second.goto(`${server.url}#map`)
  83  |   const chat = second.getByRole('complementary', { name: 'chat' })
  84  |   // The new tab shows the turn as running.
> 85  |   await expect.soft(chat.getByRole('tab').first(), 'the new tab shows the turn as running').toHaveAttribute('data-state', 'running')
      |                                                                                             ^ Error: the new tab shows the turn as running
  86  |   writeFileSync(gate, '')
  87  |   await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Done now.')
  88  | })
  89  | 
  90  | test('101.3 a client change that cannot apply in place keeps the composer draft', async ({ page, dev, server }) => {
  91  |   await page.goto(`${server.url}#map`)
  92  |   const composer = page.getByRole('textbox', { name: 'message' })
  93  |   await composer.fill(DRAFT)
  94  |   await page.evaluate(() => ((window as { beforeTheEdit?: true }).beforeTheEdit = true))
  95  |   const reloaded = page.waitForEvent('load')
  96  |   edit(join(dev.app.root, 'web', 'src', 'main.tsx'), (s) => `${s}\ndocument.documentElement.dataset.heldout = 'changed'\n`)
  97  |   await reloaded
  98  |   expect(await page.evaluate(() => (window as { beforeTheEdit?: true }).beforeTheEdit)).toBeUndefined()
  99  |   await expect(composer).toHaveValue(DRAFT)
  100 |   await expect(page.locator('html')).toHaveAttribute('data-heldout', 'changed')
  101 | })
  102 | 
  103 | test('101.4 a client change that applies in place reaches the page without a reload', async ({ page, dev, server }) => {
  104 |   await page.goto(`${server.url}#map`)
  105 |   const composer = page.getByRole('textbox', { name: 'message' })
  106 |   await composer.fill(DRAFT)
  107 |   await page.evaluate(() => ((window as { beforeTheEdit?: true }).beforeTheEdit = true))
  108 |   let loads = 0
  109 |   page.on('load', () => loads++)
  110 |   const css = join(dev.app.root, 'web', 'app.css')
  111 |   expect(existsSync(css)).toBe(true)
  112 |   edit(css, (s) => `${s}\nbody { outline: 7px solid rgb(1, 2, 3); }\n`)
  113 |   await expect(page.locator('body')).toHaveCSS('outline-color', 'rgb(1, 2, 3)', { timeout: 15_000 })
  114 |   expect(await page.evaluate(() => (window as { beforeTheEdit?: true }).beforeTheEdit)).toBe(true)
  115 |   expect(loads).toBe(0)
  116 |   await expect(composer).toHaveValue(DRAFT)
  117 | })
  118 | 
```