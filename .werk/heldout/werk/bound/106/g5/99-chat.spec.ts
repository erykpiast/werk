/** Held-out steps 99.1-99.5: the chat pane beside the map. */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import type { Page } from '@playwright/test'

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const start: FakeStep = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string): FakeStep => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const whole = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const end: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 1200, total_cost_usd: 0.01 } }
const reply = (text: string): FakeReply => ({ steps: [start, delta(text), whole(text), end] })

const textOf = (message: unknown) => (message as { message: { content: { text: string }[] } }).message.content[0]!.text
const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

/** The cards the steps name, added and accepted from the command line. */
function addCards(werk: Werk, body = 'The composer sends one turn. See #werk-chat-stdin.') {
  werk.cli(['add', 'werk-chat', '--title', 'The composer sends a live agent turn', '--parent', 'werk', '--body', body])
  werk.cli(['accept', 'werk-chat', '--actor', 'you'])
  werk.cli(['add', 'werk-onechat', '--title', 'One chat for the whole map', '--parent', 'werk'])
  werk.cli(['accept', 'werk-onechat', '--actor', 'you'])
  werk.cli(['add', 'werk-chat-stdin', '--title', 'The chat agent reads stdin', '--parent', 'werk-chat'])
  werk.cli(['accept', 'werk-chat-stdin', '--actor', 'you'])
}

/** Opens a card the way a person does: back to the whole map, then a click on the card's tile. */
async function openCard(page: Page, id: string) {
  const crumb = page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map', exact: true })
  if (await crumb.count()) await crumb.click()
  await page.locator(`li[data-card-id="${id}"] > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
}

test('99.1 Enter sends the message with its full context and the reply streams into the pane', async ({ page, werk }) => {
  addCards(werk)
  const gate1 = join(werk.dir, '..', 'gate-1')
  const gate2 = join(werk.dir, '..', 'gate-2')
  const full = 'Part one. Part two. Part three.'
  werk.scriptAgent({
    steps: [],
    roles: { chat: [{ steps: [start, delta('Part one.'), { waitFor: gate1 }, delta(' Part two.'), { waitFor: gate2 }, delta(' Part three.'), whole(full), end] }] },
  })
  await openCard(page, 'werk-chat')
  const pane = page.getByRole('complementary', { name: 'chat' })
  await expect(pane.locator('[role="tab"][data-tab="main"]')).toHaveAttribute('aria-selected', 'true')

  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.click()
  await composer.pressSequentially('What does this card decide?')
  await composer.evaluate((el) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgo='), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/chat')) requests.push(r.postData() ?? '')
  })
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat'))
  await composer.press('Enter')
  const body = (await sent).postDataJSON() as { text: string; images: { type: string; data: string }[]; card: string; tab: string }
  expect(body.text).toContain('What does this card decide?')
  expect(body.images).toHaveLength(1)
  expect(body.images[0]).toMatchObject({ type: 'image/png' })
  expect(body.card).toBe('werk-chat')
  expect(body.tab).toBe('main')

  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toHaveText('Part one.')
  expect(existsSync(gate1)).toBe(false)
  writeFileSync(gate1, '')
  await expect(replyText).toHaveText('Part one. Part two.')
  writeFileSync(gate2, '')
  await expect(replyText).toHaveText(full)
  await expect(page.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()
  expect(requests).toHaveLength(1)

  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  expect(werk.agentRuns().map((r) => r.role)).toEqual(['chat'])
  const input = textOf(runs[0]!.inputs[0])
  expect(input.split('\n')[0]).toMatch(/#werk-chat\b/)
})

test('99.2 A second message reuses the same agent and names the card open at that moment', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First reply.'), reply('Second reply.')] } })
  await openCard(page, 'werk-chat')
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('What does this card decide?')
  await composer.press('Enter')
  await expect(transcript.getByRole('listitem').first().locator('.end')).toBeVisible()
  await expect(transcript).toContainText('First reply.')

  await openCard(page, 'werk-onechat')
  await composer.click()
  await composer.pressSequentially('And this one?')
  await composer.press('Enter')
  const items = transcript.getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('First reply.')
  await expect(items.nth(1).getByLabel('reply')).toHaveText('Second reply.')

  const runs = chatRuns(werk)
  expect(werk.agentRuns()).toHaveLength(1)
  expect(runs).toHaveLength(1)
  expect(runs[0]!.inputs).toHaveLength(2)
  const firstLine = textOf(runs[0]!.inputs[1]).split('\n')[0]!
  expect(firstLine).toMatch(/#werk-onechat\b/)
  expect(firstLine).not.toMatch(/#werk-chat\b(?!-)/)
})

test('99.3 The chat pane keeps its content as the person moves through the map', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Kept reply.')] } })
  await openCard(page, 'fold')
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Kept message')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText('Kept reply.')

  const pane = page.getByRole('complementary', { name: 'chat' })
  for (const id of ['map-hash', 'werk-chat', 'werk-onechat']) {
    await openCard(page, id)
    await expect(transcript.locator('.you')).toHaveText('Kept message')
    await expect(transcript.getByLabel('reply')).toHaveText('Kept reply.')
    const mapBox = (await page.locator('main').boundingBox())!
    const paneBox = (await pane.boundingBox())!
    // Beside: the two boxes share a row and do not overlap.
    expect(paneBox.x >= mapBox.x + mapBox.width - 1 || paneBox.x + paneBox.width <= mapBox.x + 1).toBe(true)
    expect(paneBox.y < mapBox.y + mapBox.height && mapBox.y < paneBox.y + paneBox.height).toBe(true)
    await expect(composer).toBeVisible()
  }
  await composer.click()
  await composer.pressSequentially('more text')
  await expect(composer).toHaveValue('more text')
})

test('99.4 A card id in the reply opens that card on the map', async ({ page, werk }) => {
  const text = 'This card waits on **#werk-chat-stdin**, see `the pipe`.\n\n- one\n- two'
  addCards(werk, text)
  werk.scriptAgent({ steps: [], roles: { chat: [reply(text)] } })
  await openCard(page, 'werk-chat')
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('What does it wait on?')
  await composer.press('Enter')
  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toContainText('This card waits on')
  await expect(replyText.locator('.end')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()

  const replyLink = replyText.getByRole('link', { name: '#werk-chat-stdin' })
  const bodyLink = page.getByTestId('card').locator('.md').getByRole('link', { name: '#werk-chat-stdin' }).first()
  await expect(replyLink).toBeVisible()
  await expect(bodyLink).toBeVisible()
  const styleOf = (l: typeof replyLink) =>
    l.evaluate((el) => {
      const s = getComputedStyle(el)
      return { cls: el.className, color: s.color, decoration: s.textDecorationLine, weight: s.fontWeight, font: s.fontFamily }
    })
  expect(await styleOf(replyLink)).toEqual(await styleOf(bodyLink))

  const replyHtml = await replyText.locator('.md').first().innerHTML()
  const bodyHtml = await page.getByTestId('card').locator('.md').filter({ hasText: 'This card waits on' }).first().innerHTML()
  expect(replyHtml).toBe(bodyHtml)

  await replyLink.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat-stdin')
  await expect(replyText).toContainText('This card waits on')
})

test('99.5 The server has no note route for the person', async ({ page, werk }) => {
  addCards(werk)
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  const token = await page.locator('meta[name="werk-token"]').getAttribute('content')
  const res = await page.request.post(`${werk.url}api/note`, {
    data: { id: 'werk-chat', card: 'werk-chat', text: 'a note from the person' },
    headers: { 'x-werk-token': token ?? '' },
  })
  expect(res.status()).toBe(404)
  expect(await res.text()).toMatch(/no route/)
  const graph = (await (await page.request.get(`${werk.url}api/graph`)).json()) as { threads: Record<string, unknown[]> }
  expect(graph.threads['werk-chat'] ?? []).toHaveLength(0)
  await expect(page.getByTestId('card')).not.toContainText('a note from the person')
})
