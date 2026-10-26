import type { Page } from '@playwright/test'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import type { Werk } from '../../e2e/harness.ts'

let n = 0
/** A chat reply that reports a session id, says the text, and ends the turn. */
export const reply = (text: string, session = `s-${++n}`): FakeReply => ({
  steps: [
    { event: { type: 'system', subtype: 'init', session_id: session } } as FakeStep,
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})

/** Adds a card with the command line and accepts it, the way the person and an agent fill the map. */
export const addCard = (werk: Werk, id: string, parent: string, title = `The card ${id}`) => {
  werk.cli(['add', id, '--title', title, '--parent', parent, '--body', `Body of ${id}.`])
  werk.cli(['accept', id, '--actor', 'you'])
}

/** The text after --append-system-prompt in one argv, or undefined. */
export const systemPrompt = (argv: string[]): string | undefined => {
  const i = argv.indexOf('--append-system-prompt')
  return i === -1 ? undefined : argv[i + 1]
}

export const parts = (page: Page) => {
  const chat = page.getByRole('complementary', { name: 'chat' })
  return {
    chat,
    tabs: chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab'),
    composer: page.getByRole('textbox', { name: 'message' }),
    transcript: chat.getByRole('list', { name: 'transcript' }),
  }
}

export const textOf = (message: unknown) => (message as { message: { content: { text: string }[] } }).message.content[0]!.text
