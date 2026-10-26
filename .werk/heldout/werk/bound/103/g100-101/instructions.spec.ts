/** Steps 100.1-100.4: every chat conversation carries the card instructions in its system prompt. */
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const reply = (text: string, session = 's-1'): FakeReply => ({
  steps: [
    { event: { type: 'system', subtype: 'init', session_id: session } },
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})

/** The system prompt text appended in a launch argv, or undefined. */
const systemPrompt = (argv: string[]) => {
  const i = argv.indexOf('--append-system-prompt')
  return i === -1 ? undefined : argv[i + 1]
}

const instructionsOf = (werk: Werk, n: number) => {
  const launch = werk.agentLaunches()[n]
  expect(launch, `launch ${n} exists`).toBeDefined()
  const prompt = systemPrompt(launch!)
  expect(prompt, 'the launch shows a system prompt').toBeDefined()
  expect(prompt).toMatch(/how to write a card/i)
  return prompt!
}

const send = async (page: import('@playwright/test').Page, text: string) => {
  const composer = page.getByRole('textbox', { name: 'message' })
  await composer.fill(text)
  await composer.press('Enter')
}

test('100.1 a new chat conversation starts with the card wording rules in its system prompt', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Hi there.')] } })
  await page.goto(werk.url)
  await expect(page.getByRole('textbox', { name: 'message' })).toBeVisible()
  const chat = page.getByRole('complementary', { name: 'chat' })
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')).toHaveCount(2)
  await send(page, 'hello')
  await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Hi there.')
  const launches = werk.agentLaunches()
  expect(launches).toHaveLength(1)
  const text = instructionsOf(werk, 0)
  expect(text).toContain('A card describes its own subject, not the session that wrote it.')
  expect(text).toMatch(/Do not narrate the session\. Do not write who said what/)
  expect(text).toMatch(/Do not write edit history/)
})

test('100.2 the instructions forbid code names in card text', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await page.goto(`${werk.url}#map`)
  const chat = page.getByRole('complementary', { name: 'chat' })
  await page.getByTestId('card').locator('..').getByRole('link', { name: /#map-hash/ }).click({ modifiers: ['Shift'] })
  await expect(chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')).toHaveCount(2)
  await send(page, 'What does this card decide?')
  await expect(chat.getByRole('list', { name: 'transcript' })).toContainText('Ok.')
  const text = instructionsOf(werk, werk.agentLaunches().length - 1)
  expect(text).toContain('A card names behaviour and concepts.')
  expect(text).toMatch(/never names a source file, a function, a class, a constant, a line number or an internal endpoint/)
  // A card does not list its child cards.
  expect(text).toMatch(/child cards?/i)
})

test('100.3 the instructions tell the agent to read a card from the map before it writes it', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Will do.')] } })
  await page.goto(`${werk.url}#map-hash`)
  await send(page, 'Please change the body of #map-hash to say the hash holds the card id.')
  await expect(page.getByRole('list', { name: 'transcript' })).toContainText('Will do.')
  const text = instructionsOf(werk, 0)
  expect(text).toContain('Read a card from the map before you write it.')
})

test('100.4 a second chat conversation also gets the instructions', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('A reply.', 's-a')] } })
  await page.goto(`${werk.url}#map`)
  const chat = page.getByRole('complementary', { name: 'chat' })
  const transcript = chat.getByRole('list', { name: 'transcript' })
  await send(page, 'First')
  await expect(transcript).toContainText('A reply.')
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')).toHaveCount(2)
  await send(page, 'Second')
  await expect(transcript.getByLabel('reply')).toHaveText('A reply.')
  expect(werk.agentLaunches()).toHaveLength(2)
  const first = instructionsOf(werk, 0)
  const second = instructionsOf(werk, 1)
  expect(second).toBe(first)
})
