/** Held-out step 106.5: switching tabs pushes no news from other tabs. */
import { expect, test } from '../../e2e/harness.ts'
import { chatRuns, reply, textOf } from './common.ts'

test('106.5 Switching tabs does not push news from other tabs', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('News from the first tab.')] } })
  await page.goto(`${werk.url}#map`)
  const chat = page.getByRole('complementary', { name: 'chat' })
  const tabs = chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab')
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = chat.getByRole('list', { name: 'transcript' })
  // Given two conversation tabs
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(2)
  // The person sends a message in the first tab and gets a reply
  await tabs.nth(0).click()
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await composer.fill('first tab message')
  await composer.press('Enter')
  await expect(transcript).toContainText('News from the first tab.')
  const before = werk.agentRuns()
  expect(before).toHaveLength(1)
  const firstPid = before[0]!.pid

  // When the person focuses the second tab
  await tabs.nth(1).click()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  // The second tab's agent receives no message, and its transcript shows no new message
  await expect(transcript.getByRole('listitem')).toHaveCount(0)
  expect(werk.agentRuns().filter((r) => r.pid !== firstPid).flatMap((r) => r.inputs)).toEqual([])

  // When the person sends a message in the second tab
  await composer.fill('second tab message')
  await composer.press('Enter')
  await expect(transcript.getByLabel('reply')).toHaveCount(1)
  await expect(transcript.getByLabel('reply')).not.toHaveText('')
  const second = chatRuns(werk).filter((r) => r.pid !== firstPid)
  expect(second).toHaveLength(1)
  expect(second[0]!.inputs).toHaveLength(1)
  const text = textOf(second[0]!.inputs[0])
  expect(text.endsWith('\n\nsecond tab message')).toBe(true)
  expect(text).not.toContain('first tab message')
  expect(text).not.toContain('News from the first tab')
  // The first tab's agent got only its own message.
  expect(werk.agentRuns().find((r) => r.pid === firstPid)!.inputs).toHaveLength(1)
})
