import type { Page } from '@playwright/test'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, type Werk } from '../../e2e/harness.ts'

export const init = (session: string): FakeStep => ({ event: { type: 'system', subtype: 'init', session_id: session } })
export const reply = (text: string, session = 's-main'): FakeReply => ({
  steps: [
    init(session),
    { event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } },
    { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } },
  ],
})
export const textOf = (message: unknown) => (message as { message: { content: { text: string }[] } }).message.content[0]!.text
export const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

/** Adds and accepts cards: a root card and children under it. */
export function addCards(werk: Werk, root: string, children: string[]): void {
  werk.cli(['add', root, '--title', `Card ${root}`, '--body', `Body of ${root}`])
  werk.cli(['accept', root, '--actor', 'you'])
  for (const c of children) {
    werk.cli(['add', c, '--title', `Card ${c}`, '--body', `Body of ${c}`, '--parent', root])
    werk.cli(['accept', c, '--actor', 'you'])
  }
}

/** Opens the app with the given card in the address bar, as a person who opens that link. */
export async function openAt(page: Page, werk: Werk, card: string): Promise<void> {
  await page.goto(`${werk.url}#${card}`)
  await page.reload()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', card)
}

export const parts = (page: Page) => {
  const chat = page.getByRole('complementary', { name: 'chat' })
  return {
    chat,
    tabs: chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab'),
    composer: page.getByRole('textbox', { name: 'message' }),
    transcript: chat.getByRole('list', { name: 'transcript' }),
    scope: chat.locator('.chips'),
    card: page.getByTestId('card'),
    linkTo: (id: string) => page.locator(`li[data-card-id="${id}"] > a`).first(),
  }
}
