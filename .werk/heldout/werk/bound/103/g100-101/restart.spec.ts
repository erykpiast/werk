/** Step 100.5: a conversation resumed after a werk restart still carries the instructions. */
import { test as base, expect } from '@playwright/test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeDev, type Dev } from './devfixture.ts'

const test = base.extend<{ dev: Dev }>({
  dev: async ({}, use) => {
    const dev = makeDev()
    try {
      await use(dev)
    } finally {
      await dev.cleanup()
    }
  },
})

const reply = (text: string, session: string): FakeReply => ({
  steps: [
    { event: { type: 'system', subtype: 'init', session_id: session } },
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})
const promptOf = (argv: string[]) => {
  const i = argv.indexOf('--append-system-prompt')
  return i === -1 ? undefined : argv[i + 1]
}

test('100.5 a resumed conversation after a restart still carries the instructions', async ({ page, dev }) => {
  test.setTimeout(90_000)
  dev.scriptAgent({ steps: [], roles: { chat: [reply('The earlier reply.', 's-earlier')] } })
  const first = await dev.start({})
  await page.goto(`${first.url}#map`)
  const composer = page.getByRole('textbox', { name: 'message' })
  const transcript = page.getByRole('list', { name: 'transcript' })
  await composer.fill('First message')
  await composer.press('Enter')
  await expect(transcript).toContainText('The earlier reply.')

  // The user restarts werk on the same port.
  // The open page reloads itself when its dev server comes back; the user waits for the page to settle.
  const reloaded = page.waitForEvent('load', { timeout: 15_000 }).catch(() => undefined)
  await first.stop()
  dev.scriptAgent({ steps: [], roles: { chat: [reply('The later reply.', 's-earlier')] } })
  await dev.start({ port: first.port })
  await reloaded

  // The user sends a new message in the same conversation.
  await composer.fill('A new message')
  await composer.press('Enter')
  await expect(transcript).toContainText('The later reply.')
  await expect.soft(transcript, 'the transcript still shows the earlier reply').toContainText('The earlier reply.')

  const launches = dev.launches().filter((l) => l.role === 'chat')
  expect(launches).toHaveLength(2)
  const resumed = launches[1]!.argv
  // The second start is a resume of the same conversation's session.
  expect.soft(resumed, 'the second start resumes the earlier session').toEqual(expect.arrayContaining(['--resume', 's-earlier']))
  expect(promptOf(resumed)).toMatch(/how to write a card/i)
})
