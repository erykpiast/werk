# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g2/101-hot.spec.ts >> 101.2 a page opened after a server edit sees the running turn
- Location: .werk-heldout/g2/101-hot.spec.ts:62:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('tablist', { name: 'conversations' }).getByRole('tab').first()
Expected: "running"
Received: "idle"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" getByRole('tablist', { name: 'conversations' }).getByRole('tab').first() with timeout 5000ms
  - waiting for getByRole('tablist', { name: 'conversations' }).getByRole('tab').first()
    14 × locator resolved to <button role="tab" class="tab" type="button" data-tab="main" data-state="idle" aria-selected="true">…</button>
       - unexpected value "idle"

```

```yaml
- tab "the map" [selected]
```

# Test source

```ts
  1   | import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
  2   | import { join } from 'node:path'
  3   | import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
  4   | import { expect, test } from './dev.ts'
  5   | 
  6   | const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
  7   | const start = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  8   | const delta = (text: string) => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  9   | const gatedReply = (gate: string): FakeReply => ({
  10  |   steps: [
  11  |     start,
  12  |     delta('Before the edit.'),
  13  |     { waitFor: gate },
  14  |     delta(' After the edit.'),
  15  |     { event: { type: 'assistant', message: { content: [{ type: 'text', text: 'Before the edit. After the edit.' }] } } },
  16  |     { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } },
  17  |   ],
  18  | })
  19  | const editServer = (root: string) => {
  20  |   const f = join(root, 'src', 'server', 'server.ts')
  21  |   writeFileSync(f, readFileSync(f, 'utf8') + '\n// An edit by the agent.\n')
  22  | }
  23  | const alive = (pid: number) => {
  24  |   try {
  25  |     process.kill(pid, 0)
  26  |     return true
  27  |   } catch {
  28  |     return false
  29  |   }
  30  | }
  31  | 
  32  | test('101.1 a server edit during a running chat turn keeps the turn alive', async ({ page, dev }) => {
  33  |   const gate = join(dev.root, 'gate')
  34  |   dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  35  |   await page.goto(dev.url)
  36  |   const composer = page.getByRole('textbox', { name: 'message' })
  37  |   await composer.fill('Work through the edit')
  38  |   await composer.press('Enter')
  39  |   const transcript = page.getByRole('list', { name: 'transcript' })
  40  |   await expect(transcript).toContainText('Before the edit.')
  41  |   const chat = dev.launches().filter((l) => l.role === 'chat')
  42  |   expect(chat).toHaveLength(1)
  43  |   const pid = chat[0]!.pid
  44  |   const lockPath = join(dev.dir, '.werk', 'server.lock')
  45  |   const lock = readFileSync(lockPath, 'utf8')
  46  |   const lockTime = statSync(lockPath).mtimeMs
  47  | 
  48  |   editServer(dev.app.root)
  49  |   await expect.poll(dev.stderr, { timeout: 15_000 }).toContain('reusing the live server')
  50  |   expect(dev.stderr()).not.toContain('waiting for pid')
  51  |   expect(dev.stderr()).not.toContain('another werk is already serving')
  52  |   expect(readFileSync(lockPath, 'utf8')).toBe(lock)
  53  |   expect(statSync(lockPath).mtimeMs).toBe(lockTime)
  54  |   expect(alive(pid)).toBe(true)
  55  |   expect(dev.launches().map((l) => l.pid)).toEqual([pid])
  56  | 
  57  |   writeFileSync(gate, '')
  58  |   await expect(transcript.getByLabel('reply')).toHaveText('Before the edit. After the edit.')
  59  |   expect(dev.launches().map((l) => l.pid)).toEqual([pid])
  60  | })
  61  | 
  62  | test('101.2 a page opened after a server edit sees the running turn', async ({ page, dev, context }) => {
  63  |   const gate = join(dev.root, 'gate')
  64  |   dev.scriptAgent({ steps: [], roles: { chat: [gatedReply(gate)] } })
  65  |   await page.goto(dev.url)
  66  |   const composer = page.getByRole('textbox', { name: 'message' })
  67  |   await composer.fill('Run while I edit')
  68  |   await composer.press('Enter')
  69  |   await expect(page.getByRole('list', { name: 'transcript' })).toContainText('Before the edit.')
  70  | 
  71  |   editServer(dev.app.root)
  72  |   await expect.poll(dev.stderr, { timeout: 15_000 }).toContain('reusing the live server')
  73  | 
  74  |   const second = await context.newPage()
  75  |   await second.goto(dev.url)
  76  |   const tab = second.getByRole('tablist', { name: 'conversations' }).getByRole('tab').first()
> 77  |   await expect(tab).toHaveAttribute('data-state', 'running')
      |                     ^ Error: expect(locator).toHaveAttribute(expected) failed
  78  |   expect(existsSync(gate)).toBe(false)
  79  |   writeFileSync(gate, '')
  80  |   await expect(second.getByRole('list', { name: 'transcript' }).getByLabel('reply')).toHaveText('Before the edit. After the edit.')
  81  | })
  82  | 
  83  | const DRAFT = 'A draft I have not sent'
  84  | 
  85  | test('101.3 a client change that cannot apply in place keeps the composer draft', async ({ page, dev }) => {
  86  |   await page.goto(dev.url)
  87  |   const composer = page.getByRole('textbox', { name: 'message' })
  88  |   await composer.fill(DRAFT)
  89  |   await page.evaluate(() => ((window as { marker?: true }).marker = true))
  90  |   const loaded = page.waitForEvent('load', { timeout: 20_000 })
  91  |   const main = join(dev.app.root, 'web', 'src', 'main.tsx')
  92  |   writeFileSync(main, readFileSync(main, 'utf8') + `\ndocument.documentElement.dataset.heldout = 'changed'\n`)
  93  |   await loaded
  94  |   expect(await page.evaluate(() => (window as { marker?: true }).marker)).toBeUndefined()
  95  |   await expect(composer).toHaveValue(DRAFT)
  96  |   await expect(page.locator('html')).toHaveAttribute('data-heldout', 'changed')
  97  | })
  98  | 
  99  | test('101.4 a client style change applies in place without a reload', async ({ page, dev }) => {
  100 |   await page.goto(dev.url)
  101 |   const composer = page.getByRole('textbox', { name: 'message' })
  102 |   await composer.fill(DRAFT)
  103 |   await page.evaluate(() => ((window as { marker?: true }).marker = true))
  104 |   let loads = 0
  105 |   page.on('load', () => loads++)
  106 |   const css = join(dev.app.root, 'web', 'app.css')
  107 |   writeFileSync(css, readFileSync(css, 'utf8') + '\nbody { outline: 7px solid rgb(1, 2, 3); }\n')
  108 |   await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).outlineColor), { timeout: 15_000 }).toBe('rgb(1, 2, 3)')
  109 |   expect(loads).toBe(0)
  110 |   expect(await page.evaluate(() => (window as { marker?: true }).marker)).toBe(true)
  111 |   await expect(composer).toHaveValue(DRAFT)
  112 | })
  113 | 
```