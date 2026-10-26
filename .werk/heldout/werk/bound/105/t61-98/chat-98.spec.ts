import type { FakeReply } from '../../src/test/fake-agent.ts'
import { expect, test } from '../../e2e/harness.ts'

const reply = (text: string): FakeReply => ({
  steps: [
    { event: { type: 'system', subtype: 'init', session_id: 's-98' } },
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test.describe('98.3', () => {
  // The idle check is what closes a parked conversation's input; it is set short so the test can see the close.
  test.use({ werkEnv: { WERK_IDLE_MS: '200', WERK_IDLE_CHECK_MS: '50' } })

  test('98.3 a chat conversation answers each message and stays open until its input closes', async ({ page, werk }) => {
    werk.scriptAgent({ steps: [], roles: { chat: [reply('REPLY-R1'), reply('REPLY-R2')] } })
    await page.goto(`${werk.url}#map`)
    const chat = page.getByRole('complementary', { name: 'chat' })
    const composer = page.getByRole('textbox', { name: 'message' })
    const transcript = chat.getByRole('list', { name: 'transcript' })

    await composer.fill('M1')
    await composer.press('Enter')
    await expect(transcript).toContainText('REPLY-R1')
    const chats = () => werk.agentRuns().filter((r) => r.role === 'chat')
    expect(chats()).toHaveLength(1)
    const pid = chats()[0]!.pid
    expect(alive(pid)).toBe(true)

    await composer.fill('M2')
    await composer.press('Enter')
    await expect(transcript).toContainText('REPLY-R2')
    const text = (await transcript.textContent()) ?? ''
    expect(text.indexOf('REPLY-R1')).toBeLessThan(text.indexOf('REPLY-R2'))
    expect(chats()).toHaveLength(1)

    // Close the conversation: open a second one, close the first; the idle check then closes its input.
    await page.goto(`${werk.url}#fold`)
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'fold')
    await chat.getByRole('button', { name: 'New empty conversation' }).click()
    await chat.getByRole('tab', { name: 'the map' }).hover()
    await chat.getByRole('button', { name: 'Close the map' }).click()
    await expect.poll(() => alive(pid)).toBe(false)
  })
})
