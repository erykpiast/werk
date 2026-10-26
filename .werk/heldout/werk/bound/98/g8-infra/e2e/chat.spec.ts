/** 98.3: a chat conversation answers each message and stays open until its input closes. */
import { expect, test } from '../../../e2e/harness.ts'

const said = (text: string) => ({ steps: [{ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } }, { event: { type: 'result', subtype: 'success', result: text } }] })

test('98.3 a chat conversation answers each message and stays open until its input closes', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [said('Reply R1'), said('Reply R2')] } })
  // The chat pane: a text box to write a message in.
  const pane = page.getByRole('region', { name: /chat/i })
  await expect(pane).toBeVisible({ timeout: 5000 })
  const box = pane.getByRole('textbox')
  await box.fill('Message M1')
  await box.press('Enter')
  await expect(pane).toContainText('Reply R1')
  await box.fill('Message M2')
  await box.press('Enter')
  await expect(pane).toContainText('Reply R2')
  expect(werk.agentLaunches()).toHaveLength(1)
})
