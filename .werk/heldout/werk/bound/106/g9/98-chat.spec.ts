/** Held-out step 98.3: a chat conversation answers each message and stays open until its input closes. */
import { execSync } from 'node:child_process'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test } from '../../e2e/harness.ts'

const stream = (event: unknown): FakeStep => ({ event: { type: 'stream_event', event } })
const reply = (text: string): FakeReply => ({
  steps: [
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
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

test('98.3 a chat conversation answers each message and stays open until its input closes', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Reply R1.'), reply('Reply R2.')] } })
  await page.goto(werk.url)
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Message M1')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply R1.')
  const chats = () => werk.agentRuns().filter((r) => r.role === 'chat')
  expect(chats()).toHaveLength(1)
  const pid = chats()[0]!.pid
  expect(alive(pid)).toBe(true)

  await composer.fill('Message M2')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply R2.')
  const text = (await transcript.innerText()).replace(/\s+/g, ' ')
  expect(text.indexOf('Reply R1.')).toBeLessThan(text.indexOf('Reply R2.'))
  expect(chats()).toHaveLength(1)

  // The conversation input closes when the server that holds it shuts down.
  const port = new URL(werk.url).port
  const server = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`).toString().trim().split('\n')[0]!
  process.kill(Number(server), 'SIGTERM')
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
})
