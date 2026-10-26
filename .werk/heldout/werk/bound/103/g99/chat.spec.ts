/** Held-out steps 99.1 to 99.5: the chat pane. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const start: FakeStep = stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string): FakeStep => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const whole = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const end: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01 } }
const reply = (text: string): FakeReply => ({ steps: [start, delta(text), whole(text), end] })
const textOf = (message: unknown) => (message as { message: { content: { type: string; text?: string }[] } }).message.content.find((c) => c.type === 'text')!.text!
const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

const MD = 'A **strong** word, `code`, and a link to #werk-chat-stdin.'

function addCards(werk: Werk) {
  const cards: [string, string, string?][] = [
    ['werk-chat', 'The composer sends a live agent turn', MD],
    ['werk-onechat', 'One chat beside the map'],
    ['werk-chat-stdin', 'The chat agent reads stdin'],
  ]
  for (const [id, title, body] of cards) {
    werk.cli(['add', id, '--title', title, '--parent', 'werk', ...(body ? ['--body', body] : [])])
    werk.cli(['accept', id, '--actor', 'you'])
  }
}

async function openCard(page: import('@playwright/test').Page, werk: Werk, id: string) {
  await page.goto(`${werk.url}#${id}`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
}

test('99.1 Enter sends the message with its full context and the reply streams into the pane', async ({ page, werk }) => {
  addCards(werk)
  const g1 = join(werk.dir, '..', 'gate1')
  const g2 = join(werk.dir, '..', 'gate2')
  werk.scriptAgent({
    steps: [],
    roles: { chat: [{ steps: [start, delta('Part one.'), { waitFor: g1 }, delta(' Part two.'), { waitFor: g2 }, delta(' Part three.'), whole('Part one. Part two. Part three.'), end] }] },
  })
  await openCard(page, werk, 'werk-chat')
  const tab = page.getByRole('tablist', { name: 'conversations' }).getByRole('tab', { selected: true })
  await expect(tab).toBeVisible()
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
  const body = (await sent).postDataJSON() as { text: string; images: unknown[]; card: string; tab: string }
  expect(body.text).toContain('What does this card decide?')
  expect(body.images).toHaveLength(1)
  expect(body.card).toBe('werk-chat')
  expect(body.tab).toBe('main')

  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toHaveText('Part one.')
  writeFileSync(g1, '')
  await expect(replyText).toHaveText('Part one. Part two.')
  writeFileSync(g2, '')
  await expect(replyText).toHaveText('Part one. Part two. Part three.')
  expect(requests).toHaveLength(1)
  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  const first = textOf(runs[0]!.inputs.find((m) => (m as { type?: string }).type === 'user'))
  expect(first.split('\n')[0]).toContain('#werk-chat')
  expect(first.split('\n')[0]).not.toContain('#werk-chat-')
})

test('99.2 a second message reuses the same agent and names the card open at that moment', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First reply.'), reply('Second reply.')] } })
  await openCard(page, werk, 'werk-chat')
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Tell me')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText('First reply.')

  await openCard(page, werk, 'werk-onechat')
  await composer.fill('And this one?')
  await composer.press('Enter')
  const replies = transcript.getByLabel('reply')
  await expect(replies).toHaveText(['First reply.', 'Second reply.'])
  const runs = chatRuns(werk)
  expect(werk.agentRuns()).toHaveLength(1)
  expect(runs).toHaveLength(1)
  const users = runs[0]!.inputs.filter((m) => (m as { type?: string }).type === 'user').map(textOf)
  expect(users).toHaveLength(2)
  const line = users[1]!.split('\n')[0]!
  expect(line).toContain('#werk-onechat')
  expect(line).not.toMatch(/#werk-chat\b(?!-)/)
})

test('99.3 the chat pane keeps its content as the person moves through the map', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Kept reply.')] } })
  await openCard(page, werk, 'werk-chat')
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Keep me')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText('Kept reply.')
  for (const id of ['log', 'fold', 'werk-onechat']) {
    await openCard(page, werk, id)
    await expect(transcript.locator('.you')).toHaveText(['Keep me'])
    await expect(transcript.getByLabel('reply')).toHaveText(['Kept reply.'])
    await expect(composer).toBeVisible()
    await expect(page.getByTestId('card')).toBeVisible()
  }
  await composer.fill('new text')
  await expect(composer).toHaveValue('new text')
})

test('99.4 a card id in the reply opens that card on the map', async ({ page, werk }) => {
  addCards(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply(MD)] } })
  await openCard(page, werk, 'werk-chat')
  const bodyMd = page.getByTestId('card').locator('.body .md')
  const bodyHtml = await bodyMd.innerHTML()
  const bodyLinkClass = await bodyMd.getByRole('link', { name: '#werk-chat-stdin' }).getAttribute('class')
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Which card next?')
  await composer.press('Enter')
  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toContainText('A strong word')
  const link = replyText.getByRole('link', { name: '#werk-chat-stdin' })
  await expect(link).toBeVisible()
  expect(await link.getAttribute('class')).toBe(bodyLinkClass)
  expect(await replyText.locator('.md').innerHTML()).toBe(bodyHtml)
  await link.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat-stdin')
  await expect(replyText).toContainText('A strong word')
})

test('99.5 the server has no note route for the person', async ({ page, werk }) => {
  addCards(werk)
  const log = join(werk.dir, '.werk', 'log.jsonl')
  const before = readFileSync(log, 'utf8')
  const routes = ['/api/note', '/api/notes', '/api/say', '/api/cards/werk-chat/notes', '/api/note/werk-chat']
  for (const route of routes) {
    const r = await page.request.post(new URL(route, werk.url).toString(), { data: { card: 'werk-chat', id: 'werk-chat', text: 'person note' } })
    expect(r.status(), route).toBe(404)
    expect(await r.text()).toContain('no route')
  }
  expect(existsSync(log) && readFileSync(log, 'utf8')).toBe(before)
  await openCard(page, werk, 'werk-chat')
  await expect(page.getByTestId('card')).not.toContainText('person note')
})
