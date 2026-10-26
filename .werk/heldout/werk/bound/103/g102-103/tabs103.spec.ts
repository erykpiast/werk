import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { addCards, chatRuns, openAt, parts, reply, textOf } from './helpers.ts'

/** One tab per card, in order, each at its card, with the first focused. */
async function tabsOn(page: Page, werk: Werk, cards: string[]) {
  addCards(werk, 'greek', ['alpha', 'beta', 'gamma'])
  await openAt(page, werk, cards[0]!)
  const p = parts(page)
  for (const card of cards.slice(1)) {
    await page.goto(`${werk.url}#${card}`)
    await p.chat.getByRole('button', { name: 'New empty conversation' }).click()
    await expect(p.tabs.last()).toHaveText(`#${card}`)
  }
  await expect(p.tabs).toHaveText(cards.map((c) => `#${c}`))
  // Each tab back at its own card: a move on the map moved the tab that was active.
  for (const [i, card] of cards.entries()) {
    await p.tabs.nth(i).click()
    await expect(p.tabs.nth(i)).toHaveAttribute('aria-selected', 'true')
    await page.goto(`${werk.url}#${card}`)
    await expect(p.card).toHaveAttribute('data-card-id', card)
  }
  await p.tabs.nth(0).click()
  await expect(p.tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', cards[0]!)
  return p
}

test('103.1 Focusing a tab moves the map to that tab\'s card', async ({ page, werk }) => {
  const p = await tabsOn(page, werk, ['alpha', 'beta'])
  werk.scriptAgent({ steps: [], roles: { chat: [reply('About it.')] } })
  await p.tabs.nth(1).click()
  await expect(p.card).toHaveAttribute('data-card-id', 'beta')
  await expect(p.scope).toHaveText('#beta')
  await p.composer.fill('What is this card?')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('About it.')
  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  const input = textOf(runs[0]!.inputs[0])
  expect(input.split('\n')[0]).toContain('#beta')
  expect(input).not.toContain('#alpha')
})

test('103.2 Each tab restores its own map position after a switch', async ({ page, werk }) => {
  const p = await tabsOn(page, werk, ['alpha', 'beta'])
  await page.goto(`${werk.url}#greek`)
  await p.linkTo('gamma').click()
  await expect(p.card).toHaveAttribute('data-card-id', 'gamma')
  await expect(p.scope).toHaveText('#gamma')
  await p.tabs.nth(1).click()
  await expect(p.card).toHaveAttribute('data-card-id', 'beta')
  await p.tabs.nth(0).click()
  await expect(p.card).toHaveAttribute('data-card-id', 'gamma')
  await expect(p.scope).toHaveText('#gamma')
  await p.tabs.nth(1).click()
  await expect(p.card).toHaveAttribute('data-card-id', 'beta')
})

test('103.3 An unsent draft stays with its tab', async ({ page, werk }) => {
  const p = await tabsOn(page, werk, ['alpha', 'beta'])
  const chats: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/chat')) chats.push(r.postData() ?? '')
  })
  await p.composer.click()
  await p.composer.pressSequentially('half-written note about alpha')
  await p.tabs.nth(1).click()
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.composer).not.toHaveValue(/half-written note about alpha/)
  await expect(p.transcript).not.toContainText('half-written note about alpha')
  await p.tabs.nth(0).click()
  await expect(p.composer).toHaveValue(/half-written note about alpha/)
  await expect(p.transcript).not.toContainText('half-written note about alpha')
  expect(chats).toEqual([])
  expect(werk.agentLaunches()).toEqual([])
})

test('103.4 Cmd+number selects a tab by its position', async ({ page, werk }) => {
  const p = await tabsOn(page, werk, ['alpha', 'beta', 'gamma'])
  await page.keyboard.press('Meta+2')
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', 'beta')
  await page.keyboard.press('Meta+3')
  await expect(p.tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', 'gamma')
})

test('103.5 Cmd+] and Cmd+[ step to the next and previous tab', async ({ page, werk }) => {
  const p = await tabsOn(page, werk, ['alpha', 'beta', 'gamma'])
  await page.keyboard.press('Meta+BracketRight')
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', 'beta')
  await page.keyboard.press('Meta+BracketRight')
  await expect(p.tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Meta+BracketLeft')
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', 'beta')
})
