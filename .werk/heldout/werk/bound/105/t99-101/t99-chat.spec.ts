/** Held-out steps of ticket 99: the chat pane sends a turn with its context and streams the reply. */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { addCard, chatRuns, delta, end, reply, start, textOf, whole } from './common.ts'

const firstId = (s: string) => /#[a-z0-9-]+/.exec(s)?.[0]

test('99.1 Enter sends the message with its full context and the reply streams into the pane', async ({ page, werk }) => {
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn')
  const g1 = join(werk.dir, '..', 'part-2')
  const g2 = join(werk.dir, '..', 'part-3')
  const full = 'Part one. Part two. Part three.'
  werk.scriptAgent({
    steps: [],
    roles: { chat: [{ steps: [start, delta('Part one.'), { waitFor: g1 }, delta(' Part two.'), { waitFor: g2 }, delta(' Part three.'), whole(full), end] }] },
  })
  // Given the person has the map open with card "#werk-chat" open
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  // And the "main" conversation tab is active in the chat pane
  const chat = page.getByRole('complementary', { name: 'chat' })
  await expect(chat).toHaveAttribute('data-tab', 'main')
  const composer = page.getByRole('textbox', { name: 'message' })
  // When the person types the text and pastes an image
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
  expect(body.images).toEqual([{ type: 'image/png', data: 'iVBORw0KGgo=' }])
  expect(body.card).toBe('werk-chat')
  expect(body.tab).toBe('main')
  // The reply appears part by part
  const replyText = chat.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toHaveText('Part one.')
  expect(existsSync(g1)).toBe(false)
  writeFileSync(g1, '')
  await expect(replyText).toHaveText('Part one. Part two.')
  writeFileSync(g2, '')
  await expect(replyText).toHaveText(full)
  await expect(chat.getByRole('list', { name: 'transcript' }).locator('.end')).toBeVisible()
  expect(requests).toHaveLength(1)
  // The launch record shows the chat role, and the turn input starts with the id "#werk-chat"
  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  const input = textOf(runs[0]!.inputs[0])
  expect(firstId(input)).toBe('#werk-chat')
})

test('99.2 A second message reuses the same agent and names the card open at that moment', async ({ page, werk }) => {
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn')
  addCard(werk, 'werk-onechat', 'One chat beside the map')
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First reply.'), reply('Second reply.')] } })
  await page.goto(`${werk.url}#werk-chat`)
  const transcript = page.getByRole('list', { name: 'transcript' })
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('What is this?')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText(['First reply.'])
  const pidsBefore = werk.agentRuns().map((r) => r.pid)

  await page.goto(`${werk.url}#werk-onechat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-onechat')
  await composer.fill('And this one?')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText(['First reply.', 'Second reply.'])
  expect(werk.agentRuns().map((r) => r.pid)).toEqual(pidsBefore)
  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  const second = textOf(runs[0]!.inputs[1])
  const firstLine = second.split('\n')[0]!
  expect(firstLine).toContain('#werk-onechat')
  expect(firstLine).not.toContain('#werk-chat ')
  expect(firstId(firstLine)).toBe('#werk-onechat')
})

test('99.3 The chat pane keeps its content as the person moves through the map', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('A kept reply.')] } })
  await page.goto(`${werk.url}#map`)
  const transcript = page.getByRole('list', { name: 'transcript' })
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('Keep me')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText('A kept reply.')
  for (const id of ['map-hash', 'fold', 'log']) {
    await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map', exact: true }).click()
    await page.locator(`li[data-card-id="${id}"] > a`).first().click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
    await expect(transcript.locator('.you')).toHaveText('Keep me')
    await expect(transcript.getByLabel('reply')).toHaveText('A kept reply.')
  }
  await expect(composer).toBeVisible()
  await expect(page.getByTestId('card')).toBeVisible()
  await composer.fill('More text')
  await expect(composer).toHaveValue('More text')
})

test('99.4 A card id in the reply opens that card on the map', async ({ page, werk }) => {
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn', 'map', 'See #map-hash for the hash.')
  addCard(werk, 'werk-chat-stdin', 'The chat child reads its turns on stdin')
  const md = 'The turn goes over **stdin**, see #werk-chat-stdin.\n\n- one\n- two'
  werk.scriptAgent({ steps: [], roles: { chat: [reply(md)] } })
  await page.goto(`${werk.url}#werk-chat`)
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill('How does the turn reach the agent?')
  await composer.press('Enter')
  const replyText = page.getByRole('list', { name: 'transcript' }).getByLabel('reply')
  await expect(replyText).toContainText('see #werk-chat-stdin')
  const link = replyText.getByRole('link', { name: '#werk-chat-stdin' })
  await expect(link).toBeVisible()
  const bodyLink = page.getByTestId('card').locator('a.ref').first()
  await expect(bodyLink).toBeVisible()
  expect(await link.getAttribute('class')).toBe(await bodyLink.getAttribute('class'))
  // The reply Markdown renders as a card body renders
  await expect(replyText.locator('.md strong')).toHaveText('stdin')
  await expect(replyText.locator('.md li')).toHaveText(['one', 'two'])
  await link.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat-stdin')
  await expect(replyText).toContainText('see #werk-chat-stdin')
})

test('99.5 The server has no note route for the person', async ({ page, werk }) => {
  addCard(werk, 'werk-chat', 'The composer sends a live agent turn')
  await page.goto(`${werk.url}#werk-chat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-chat')
  const token = await page.locator('meta[name="werk-token"]').getAttribute('content')
  const statuses: number[] = []
  for (const path of ['api/note', 'api/notes', 'api/say', 'api/cards/werk-chat/notes', 'api/note/werk-chat']) {
    const res = await page.request.post(`${werk.url}${path}`, {
      headers: { 'content-type': 'application/json', 'x-werk-token': token ?? '' },
      data: { card: 'werk-chat', id: 'werk-chat', text: 'A note from the person' },
    })
    statuses.push(res.status())
    expect(await res.text()).toContain('no route')
  }
  expect(statuses.every((s) => s === 404)).toBe(true)
  expect(werk.cli(['inbox'])).not.toContain('A note from the person')
  await expect(page.getByTestId('card')).not.toContainText('A note from the person')
})
