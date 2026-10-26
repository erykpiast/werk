/** Held-out step 106.5: switching tabs does not push news from other tabs. */
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const init: FakeStep = { event: { type: 'system', subtype: 'init', session_id: 's-main' } }
const reply = (text: string): FakeReply => ({
  steps: [
    init,
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})
const textOf = (message: unknown) => (message as { message: { content: { text: string }[] } }).message.content[0]!.text
const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

test('106.5 switching tabs does not push news from other tabs', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Reply one.'), reply('Reply two.'), reply('Reply three.')] } })
  await page.goto(`${werk.url}#map`)
  const chat = page.getByRole('complementary', { name: 'chat' })
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = chat.getByRole('list', { name: 'transcript' })
  const tabs = chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')

  // Two tabs, each with its own agent.
  await composer.fill('Hello first')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply one.')
  await page.getByTestId('card').locator('..').getByRole('link', { name: /#map-hash/ }).click({ modifiers: ['Shift'] })
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await composer.fill('Hello second')
  await composer.press('Enter')
  await expect(transcript.getByRole('listitem')).toHaveCount(1)
  await expect(transcript).not.toContainText('Hello first')
  await expect.poll(() => chatRuns(werk).length).toBe(2)
  const secondPid = chatRuns(werk)[1]!.pid

  // The person sends a message in the first tab and gets a reply.
  await tabs.nth(0).click()
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await composer.fill('News in first tab')
  await composer.press('Enter')
  await expect(transcript).toContainText('News in first tab')
  await expect(transcript.getByRole('listitem')).toHaveCount(2)
  await expect(transcript.getByRole('listitem').last()).not.toHaveText(/^\s*News in first tab\s*$/)
  const second = () => chatRuns(werk).find((r) => r.pid === secondPid)!
  const before = second().inputs.length

  // The person focuses the second tab.
  await tabs.nth(1).click()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  const items = transcript.getByRole('listitem')
  await expect(items).toHaveCount(1)
  await expect(transcript).not.toContainText('News in first tab')
  expect(second().inputs.length).toBe(before)

  // The person sends a message in the second tab.
  await composer.fill('Only this')
  await composer.press('Enter')
  await expect.poll(() => second().inputs.length).toBe(before + 1)
  const got = textOf(second().inputs[before])
  expect(got).toMatch(/Only this$/)
  expect(got).not.toContain('News in first tab')
  expect(got).not.toContain('Hello first')
  expect(chatRuns(werk)).toHaveLength(2)
})
