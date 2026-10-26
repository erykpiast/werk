/** Shared helpers for the held-out tests of tickets 102 to 105. */
import type { Page } from '@playwright/test'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, type Werk } from '../../e2e/harness.ts'

export const init = (session = 's-main'): FakeStep => ({ event: { type: 'system', subtype: 'init', session_id: session } })
export const say = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
export const result: FakeStep = { event: { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.01 } }
export const reply = (text: string, before: FakeStep[] = [], session = 's-main'): FakeReply => ({ steps: [init(session), ...before, say(text), result] })

export const textOf = (message: unknown): string => {
  const m = message as { message?: { content?: unknown } }
  const c = m.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p: { text?: string }) => p.text ?? '').join('')
  return JSON.stringify(message)
}
export const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Adds and accepts real cards from the command line: root, and its children. */
export function addCards(werk: Werk, cards: [id: string, parent?: string][]) {
  for (const [id, parent] of cards) {
    werk.cli(['add', id, '--title', `Card ${id}`, '--body', `The body of ${id}.`, ...(parent ? ['--parent', parent] : [])])
    werk.cli(['accept', id, '--actor', 'you'])
  }
}

export const STANDARD: [string, string?][] = [
  ['root'],
  ['alpha', 'root'],
  ['beta', 'root'],
  ['gamma', 'root'],
  ['werk-mc-fork', 'root'],
  ['werk-mc-split', 'root'],
  ['werk-mc-tabs', 'root'],
  ['werk-onechat', 'root'],
]

export const parts = (page: Page) => {
  const chat = page.getByRole('complementary', { name: 'chat' })
  return {
    chat,
    chips: chat.getByRole('tablist', { name: 'conversations' }).getByRole('tab'),
    more: chat.getByRole('button', { name: /^All conversations/ }),
    menu: chat.getByRole('menu', { name: 'all conversations' }),
    composer: page.getByRole('textbox', { name: 'message' }),
    transcript: chat.getByRole('list', { name: 'transcript' }),
    scope: chat.locator('.chips'),
    card: page.getByTestId('card'),
  }
}

/** Opens the app fresh at a card, so the first tab is homed there. */
export async function openAppAt(page: Page, werk: Werk, card: string) {
  await page.goto('about:blank')
  await page.goto(`${werk.url}#${card}`)
  await expect(parts(page).card).toHaveAttribute('data-card-id', card)
}

/** Navigates the map to a card, as a person does with the address bar. */
export async function navigate(page: Page, werk: Werk, card: string) {
  await page.goto(`${werk.url}#${card}`)
  await expect(parts(page).card).toHaveAttribute('data-card-id', card)
}

/**
 * Opens one tab per card, in order: the first is the tab the app opens with, each next one an
 * empty conversation. Each tab ends at its own card, and the first tab is focused.
 */
export async function tabsAt(page: Page, werk: Werk, cards: string[]) {
  const { chat, chips } = parts(page)
  await openAppAt(page, werk, cards[0]!)
  for (const card of cards.slice(1)) {
    await navigate(page, werk, card)
    await chat.getByRole('button', { name: 'New empty conversation' }).click()
    await expect(chat.getByRole('tab', { name: `#${card}` })).toHaveAttribute('aria-selected', 'true')
  }
  // Each earlier tab moved on to the next card before the next tab opened. Move it back.
  for (const [i, card] of cards.slice(0, -1).entries()) {
    await chips.nth(i).click()
    await navigate(page, werk, card)
  }
  await chips.nth(0).click()
  await expect(parts(page).card).toHaveAttribute('data-card-id', cards[0]!)
  await expect(chips).toHaveText(cards.map((c) => `#${c}`))
}

export async function send(page: Page, text: string) {
  const { composer } = parts(page)
  await composer.fill(text)
  await composer.press('Enter')
}

/** The computed background colour and animation name of a chip's dot. */
export async function dotStyle(chip: ReturnType<Page['locator']>) {
  return chip.locator('.dot').evaluate((el) => {
    const s = getComputedStyle(el)
    return { color: s.backgroundColor, animation: s.animationName }
  })
}
export const YELLOW = 'rgb(212, 161, 6)'
export const RED = 'rgb(179, 38, 30)'
