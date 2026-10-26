/** Held-out steps of ticket 100: every chat conversation starts with the card wording rules in its system prompt. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { chatRuns, reply, systemPrompt, textOf } from './common.ts'

const flat = (s: string) => s.replace(/\s+/g, ' ')

/** The launch argv of the chat run whose input holds the message `text`. */
function launchFor(werk: Werk, text: string): string[] {
  const runs = werk.agentRuns()
  const at = runs.findIndex((r) => r.role === 'chat' && r.inputs.some((i) => textOf(i).endsWith(text)))
  expect(at, `a chat launch that read "${text}"`).toBeGreaterThanOrEqual(0)
  return werk.agentLaunches()[at]!
}

const pane = (page: Page) => {
  const chat = page.getByRole('complementary', { name: 'chat' })
  return {
    chat,
    tabs: chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab'),
    composer: page.getByRole('textbox', { name: 'message' }),
    transcript: chat.getByRole('list', { name: 'transcript' }),
  }
}

test('100.1 A new chat conversation starts with the card wording rules in its system prompt', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Hi.')] } })
  await page.goto(werk.url)
  await expect(page.locator('li[data-card-id]').first()).toBeVisible()
  const { chat, tabs, composer, transcript } = pane(page)
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)
  await composer.fill('hello')
  await composer.press('Enter')
  await expect(transcript).toContainText('Hi.')
  const prompt = systemPrompt(launchFor(werk, 'hello'))
  expect(prompt).toBeDefined()
  const text = flat(prompt!)
  expect(text).toContain('how to write a card on the map')
  expect(text).toContain('A card describes its own subject, not the session that wrote it.')
  expect(text).toMatch(/Do not narrate the session\. Do not write who said what/)
  expect(text).toMatch(/Do not write edit history/)
})

test('100.2 The instructions forbid code names in card text', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await page.goto(`${werk.url}#map`)
  const { tabs, composer, transcript } = pane(page)
  await page.getByTestId('card').locator('..').getByRole('link', { name: /#map-hash/ }).click({ modifiers: ['Shift'] })
  await expect(tabs).toHaveCount(2)
  await composer.fill('Tell me about this card')
  await composer.press('Enter')
  await expect(transcript).toContainText('Ok.')
  const prompt = systemPrompt(launchFor(werk, 'Tell me about this card'))
  expect(prompt).toBeDefined()
  const text = flat(prompt!)
  expect(text).toContain('how to write a card on the map')
  expect(text).toContain('A card names behaviour and concepts.')
  expect(text).toMatch(/never names a source file, a function, a class, a constant, a line number or an internal endpoint/)
  // The text says that a card does not list its child cards.
  expect(text).toMatch(/(child cards|children|sub-cards)/i)
})

test('100.3 The instructions tell the agent to read a card from the map before it writes it', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Done.')] } })
  await page.goto(`${werk.url}#map-hash`)
  const { chat, tabs, composer, transcript } = pane(page)
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)
  const ask = 'Change the body of #map-hash to say the hash keeps the card open'
  await composer.fill(ask)
  await composer.press('Enter')
  await expect(transcript).toContainText('Done.')
  const prompt = systemPrompt(launchFor(werk, ask))
  expect(prompt).toBeDefined()
  const text = flat(prompt!)
  expect(text).toContain('Read a card from the map before you write it.')
})

test('100.4 A second chat conversation also gets the instructions', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('First answer.'), reply('Second answer.')] } })
  await page.goto(`${werk.url}#map`)
  const { chat, tabs, composer, transcript } = pane(page)
  await composer.fill('first conversation')
  await composer.press('Enter')
  await expect(transcript).toContainText('First answer.')
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)
  await composer.fill('second conversation')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveCount(1)
  await expect(transcript.getByLabel('reply')).not.toHaveText('')
  const first = systemPrompt(launchFor(werk, 'first conversation'))
  const second = systemPrompt(launchFor(werk, 'second conversation'))
  expect(chatRuns(werk)).toHaveLength(2)
  expect(second).toBeDefined()
  expect(flat(second!)).toContain('how to write a card on the map')
  expect(second).toBe(first)
})

test('100.5 A resumed conversation after a restart still carries the instructions', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('A reply.', 's-one')] } })
  await page.goto(`${werk.url}#map`)
  const { composer, transcript } = pane(page)
  await composer.fill('first message')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveText(['A reply.'])

  // The user restarts werk: the running server stops, and a new one starts on the same port.
  const lockPath = join(werk.dir, '.werk', 'server.lock')
  const holder = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; port: number }
  // The dev client reloads the page when its server comes back, as the person sees.
  const reloaded = page.waitForEvent('load', { timeout: 20_000 })
  process.kill(holder.pid, 'SIGTERM')
  await expect.poll(() => existsSync(lockPath)).toBe(false)
  werk.start(['serve', '--port', String(holder.port)])
  await expect.poll(async () => (await fetch(werk.url).catch(() => undefined))?.status).toBe(200)
  await reloaded
  await expect(composer).toBeVisible()

  await composer.fill('second message')
  await composer.press('Enter')
  await expect(transcript.locator('.you').last()).toHaveText('second message')
  await expect(transcript.getByLabel('reply').last()).toHaveText('A reply.')
  // Then the conversation transcript still shows the earlier reply
  await expect.soft(transcript.locator('.you')).toHaveText(['first message', 'second message'])
  await expect.soft(transcript.getByLabel('reply')).toHaveText(['A reply.', 'A reply.'])
  const launch = launchFor(werk, 'second message')
  const prompt = systemPrompt(launch)
  expect(prompt).toBeDefined()
  expect(flat(prompt!)).toContain('how to write a card on the map')
  // The resumed start: the launch resumes the conversation's session.
  expect(launch).toContain('--resume')
})
