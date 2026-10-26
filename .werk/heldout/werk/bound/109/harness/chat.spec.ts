/** Held-out step 98.3: a chat conversation answers each message and stays open until its input closes. */
import { execFileSync } from 'node:child_process'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, test } from '../../e2e/harness.ts'

const whole = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const end: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } }
const reply = (text: string): FakeReply => ({ steps: [whole(text), end] })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('98.3 a chat conversation answers each message and stays open until its input closes', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Reply R-one.'), reply('Reply R-two.')] } })
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Message M-one')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply R-one.')

  const chats = () => werk.agentRuns().filter((r) => r.role === 'chat')
  expect(chats()).toHaveLength(1)
  const pid = chats()[0]!.pid
  expect(alive(pid)).toBe(true)

  await composer.fill('Message M-two')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply R-two.')
  const turns = transcript.getByRole('listitem')
  await expect(turns).toHaveCount(2)
  await expect(turns.nth(0)).toContainText('Reply R-one.')
  await expect(turns.nth(1)).toContainText('Reply R-two.')
  expect(chats()).toHaveLength(1)
  expect(alive(pid)).toBe(true)

  // The conversation input closes when the server that holds it shuts down: it ends the chat child's stdin.
  const server = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
  process.kill(server, 'SIGTERM')
  await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false)
})
