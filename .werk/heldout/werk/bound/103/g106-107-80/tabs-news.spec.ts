/** Held-out step 106.5: switching tabs pushes no news from the other tabs. */
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const reply = (session: string, text: string): FakeReply => ({
  steps: [
    { event: { type: 'system', subtype: 'init', session_id: session } },
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})
const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

test('106.5 switching tabs does not push news from other tabs', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('s-x', 'Reply in the first tab about pricing.')] } })
  await page.goto(`${werk.url}#map`)
  const chat = page.getByRole('complementary', { name: 'chat' })
  const tabs = chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = chat.getByRole('list', { name: 'transcript' })

  await page.goto(`${werk.url}#fold`)
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)

  await tabs.nth(0).click()
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await composer.fill('Message in the first tab')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply in the first tab about pricing.')
  const runsAfterFirst = chatRuns(werk)
  expect(runsAfterFirst).toHaveLength(1)
  const firstPid = runsAfterFirst[0]!.pid

  await tabs.nth(1).click()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.waitForTimeout(1000)
  const others = chatRuns(werk).filter((r) => r.pid !== firstPid)
  for (const r of others) expect(r.inputs).toEqual([])
  expect(chatRuns(werk).find((r) => r.pid === firstPid)!.inputs).toHaveLength(1)
  await expect(transcript.getByRole('listitem')).toHaveCount(0)

  await composer.fill('Message in the second tab')
  await composer.press('Enter')
  await expect.poll(() => chatRuns(werk).filter((r) => r.pid !== firstPid).length).toBe(1)
  const second = () => chatRuns(werk).find((r) => r.pid !== firstPid)!
  await expect.poll(() => second().inputs.length).toBe(1)
  await expect(transcript).toContainText('Reply in the first tab about pricing.')
  const input = JSON.stringify(second().inputs)
  expect(input).toContain('Message in the second tab')
  expect(input).not.toContain('Message in the first tab')
  expect(input).not.toContain('Reply in the first tab')
})
