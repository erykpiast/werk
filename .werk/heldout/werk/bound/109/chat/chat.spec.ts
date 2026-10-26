/** Held-out steps 99.1 - 99.5: the chat pane. */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const start: FakeStep = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string): FakeStep => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const whole = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const end: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 1200, total_cost_usd: 0.01 } }
const reply = (text: string): FakeReply => ({ steps: [start, delta(text), whole(text), end] })
const textOf = (m: unknown) => (m as { message: { content: { text: string }[] } }).message.content[0]!.text
const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

const MD = ['## Plan', '', 'See #werk-chat-stdin for the **input** side.', '', '- one `code`', '- two', '', '```bash', 'werk show x', '```'].join('\n')

function addCards(werk: Werk, chatBody = 'The chat pane.') {
  werk.cli(['add', 'werk-chat', '--title', 'Chat beside the map', '--parent', 'werk', '--body', chatBody])
  werk.cli(['add', 'werk-onechat', '--title', 'One chat agent', '--parent', 'werk-chat'])
  werk.cli(['add', 'werk-chat-stdin', '--title', 'Chat over stdin', '--parent', 'werk-onechat'])
  for (const id of ['werk-chat', 'werk-onechat', 'werk-chat-stdin']) werk.cli(['accept', id, '--actor', 'you'])
}

async function pasteImage(composer: import('@playwright/test').Locator) {
  await composer.evaluate((el) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
}

test('99.1 Enter sends the message with its full context and the reply streams into the pane', async ({ page, werk }) => {
  addCards(werk)
  const g1 = join(werk.dir, '..', 'gate1')
  const g2 = join(werk.dir, '..', 'gate2')
  const full = 'Part one. Part two. Part three.'
  werk.scriptAgent({
    steps: [],
    roles: { chat: [{ steps: [start, delta('Part one.'), { waitFor: g1 }, delta(' Part two.'), { waitFor: g2 }, delta(' Part three.'), whole(full), end] }] },
  })
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  await expect(page.getByRole('complementary', { name: 'chat' })).toHaveAttribute('data-tab', 'main')
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.click()
  await composer.pressSequentially('What does this card decide?')
  await pasteImage(composer)
  await expect(composer).toHaveValue(/\[Image #1\]/)
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/chat')) requests.push(r.postData() ?? '')
  })
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat'))
  await composer.press('Enter')
  const body = (await sent).postDataJSON() as { text: string; images: { type: string; data: string }[]; card: string; tab: string }
  expect(body.text).toContain('What does this card decide?')
  expect(body.images).toEqual([{ type: 'image/png', data: 'iVBORw0KGgo=' }])
  expect(body.card).toBe('werk-chat')
  expect(body.tab).toBe('main')

  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toHaveText('Part one.')
  expect(existsSync(g1)).toBe(false)
  writeFileSync(g1, '')
  await expect(replyText).toHaveText('Part one. Part two.')
  writeFileSync(g2, '')
  await expect(replyText).toHaveText(full)
  await expect(page.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()
  expect(requests).toHaveLength(1)

  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  expect(werk.agentRuns().map((r) => r.role)).toEqual(['chat'])
  const input = textOf(runs[0]!.inputs[0])
  // The first card id the input names is #werk-chat (not a longer id).
  expect(input.match(/#[a-z0-9-]+/)?.[0]).toBe('#werk-chat')
  expect(input.split('\n')[0]).toContain('#werk-chat')
})

test('99.2 A second message reuses the same agent and names the card open at that moment', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First answer.'), reply('Second answer.')] } })
  await page.goto(`${werk.url}#werk-chat`)
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('What is this?')
  await composer.press('Enter')
  await expect(transcript.getByRole('listitem').nth(0).locator('.end')).toBeVisible()
  await expect(transcript).toContainText('First answer.')

  await page.locator('li[data-card-id="werk-onechat"] > a').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-onechat')
  await composer.fill('And this one?')
  await composer.press('Enter')
  const items = transcript.getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0).getByLabel('reply')).toHaveText('First answer.')
  await expect(items.nth(1).getByLabel('reply')).toHaveText('Second answer.')

  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  expect(werk.agentRuns()).toHaveLength(1)
  expect(runs[0]!.inputs).toHaveLength(2)
  const firstLine = textOf(runs[0]!.inputs[1]).split('\n')[0]!
  expect(firstLine).toMatch(/#werk-onechat\b/)
  expect(firstLine).not.toMatch(/#werk-chat(?![-\w])/)
})

test('99.3 The chat pane keeps its content as the person moves through the map', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Kept reply.')] } })
  await page.goto(`${werk.url}#werk-chat`)
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Keep me')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText('Kept reply.')

  const check = async (id: string) => {
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
    await expect(transcript.getByRole('listitem')).toHaveCount(1)
    await expect(transcript.locator('.you')).toHaveText('Keep me')
    await expect(transcript.getByLabel('reply')).toHaveText('Kept reply.')
  }
  await page.locator('li[data-card-id="werk-onechat"] > a').click()
  await check('werk-onechat')
  await page.locator('li[data-card-id="werk-chat-stdin"] > a').click()
  await check('werk-chat-stdin')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'werk: a visual layer over Claude Code' }).click()
  await check('werk')

  await expect(composer).toBeVisible()
  await expect(composer).toBeEditable()
  await composer.fill('new text')
  await expect(composer).toHaveValue('new text')
  const chatBox = await page.getByRole('complementary', { name: 'chat' }).boundingBox()
  const mapBox = await page.locator('main').boundingBox()
  expect(chatBox && mapBox).toBeTruthy()
  // Beside the map: the boxes do not overlap and sit side by side.
  const side = chatBox!.x >= mapBox!.x + mapBox!.width - 1 || chatBox!.x + chatBox!.width <= mapBox!.x + 1
  expect(side).toBe(true)
})

test('99.4 A card id in the reply opens that card on the map', async ({ page, werk }) => {
  addCards(werk, MD)
  werk.scriptAgent({ steps: [], roles: { chat: [reply(MD)] } })
  await page.goto(`${werk.url}#werk-chat`)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Where is stdin?')
  await composer.press('Enter')
  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toContainText('See #werk-chat-stdin for the input side.')
  await expect(page.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()

  const link = replyText.getByRole('link', { name: '#werk-chat-stdin' })
  await expect(link).toHaveAttribute('href', '#werk-chat-stdin')
  const bodyLink = page.getByTestId('card').locator('.body a', { hasText: '#werk-chat-stdin' })
  const style = (l: typeof link) =>
    l.evaluate((el) => {
      const s = getComputedStyle(el)
      return { color: s.color, textDecoration: s.textDecorationLine, fontFamily: s.fontFamily, fontWeight: s.fontWeight, className: el.className }
    })
  expect(await style(link)).toEqual(await style(bodyLink))
  const replyHtml = await replyText.locator('.md').innerHTML()
  const bodyHtml = await page.getByTestId('card').locator('.body .md').innerHTML()
  expect(replyHtml).toBe(bodyHtml)

  await link.click()
  await expect(page).toHaveURL(/#werk-chat-stdin$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat-stdin')
  await expect(replyText).toContainText('See #werk-chat-stdin for the input side.')
})

test('99.5 The server has no note route for the person', async ({ page, werk }) => {
  addCards(werk)
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  const token = await page.locator('meta[name="werk-token"]').getAttribute('content')
  const statuses: number[] = []
  const bodies: string[] = []
  for (const path of ['api/note', 'api/notes', 'api/say', 'api/cards/werk-chat/notes', 'api/card/werk-chat/note']) {
    const res = await page.request.post(`${werk.url}${path}`, {
      headers: { 'content-type': 'application/json', 'x-werk-token': token ?? '' },
      data: { card: 'werk-chat', id: 'werk-chat', text: 'A note from the person' },
    })
    statuses.push(res.status())
    bodies.push(await res.text())
  }
  expect(statuses).toEqual([404, 404, 404, 404, 404])
  for (const b of bodies) expect(b).toMatch(/no route/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  await expect(page.getByRole('region', { name: 'notes' })).toHaveCount(0)
  await expect(page.getByTestId('card')).not.toContainText('A note from the person')
  expect(werk.cli(['show', 'werk-chat'])).not.toContain('A note from the person')
})
