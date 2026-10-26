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
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Reply R1 here.'), reply('Reply R2 here.')] } })
  await page.goto(werk.url)
  const pane = page.getByRole('complementary', { name: 'chat' })
  await expect(pane).toBeVisible()
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('Message M1')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply R1 here.')
  const runs = werk.agentRuns().filter((r) => r.role === 'chat')
  expect(runs).toHaveLength(1)
  const pid = runs[0]!.pid
  await page.waitForTimeout(500)
  expect(alive(pid)).toBe(true)

  await composer.fill('Message M2')
  await composer.press('Enter')
  await expect(transcript).toContainText('Reply R2 here.')
  const text = (await transcript.innerText())
  expect(text.indexOf('Reply R1 here.')).toBeLessThan(text.indexOf('Reply R2 here.'))
  expect(werk.agentRuns().filter((r) => r.role === 'chat')).toHaveLength(1)
  expect(werk.agentLaunches()).toHaveLength(1)

  // The conversation input closes when the server that holds it stops.
  const server = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
  process.kill(server, 'SIGTERM')
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false)
})
