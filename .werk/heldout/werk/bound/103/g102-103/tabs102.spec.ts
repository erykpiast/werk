import { expect, test, type Werk } from '../../e2e/harness.ts'
import { addCards, chatRuns, openAt, parts, reply, textOf } from './helpers.ts'
import type { Page } from '@playwright/test'

const CHILDREN = ['werk-mc-fork', 'werk-mc-split', 'werk-mc-tabs', 'werk-onechat']

/** Two tabs, '#root' (the first) and '#werk-mc-fork', with '#root' active. */
async function twoTabs(page: Page, werk: Werk) {
  addCards(werk, 'root', CHILDREN)
  await openAt(page, werk, 'root')
  const p = parts(page)
  await expect(p.tabs).toHaveText(['#root'])
  await page.goto(`${werk.url}#werk-mc-fork`)
  await p.chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(p.tabs).toHaveText(['#root', '#werk-mc-fork'])
  await p.tabs.nth(0).click()
  await expect(p.tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  // The first tab moved with the map to #werk-mc-fork before the second tab opened; bring it back.
  await page.goto(`${werk.url}#root`)
  await expect(p.card).toHaveAttribute('data-card-id', 'root')
  await expect(p.tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  return p
}

test('102.1 Shift+click on a card forks a new conversation rooted there and focuses it', async ({ page, werk }) => {
  addCards(werk, 'root', CHILDREN)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('One.', 's-main'), reply('Two.', 's-fork')] } })
  await openAt(page, werk, 'root')
  const p = parts(page)
  await expect(p.tabs).toHaveCount(1)
  await p.composer.fill('First')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('One.')

  await p.linkTo('werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(p.tabs).toHaveCount(2)
  await expect(p.tabs.nth(1)).toHaveText('#werk-mc-fork')
  await expect(p.tabs.nth(1).locator('.dot')).toBeVisible()
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', 'werk-mc-fork')

  await p.composer.fill('Branch')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('One.')
  const launches = werk.agentLaunches()
  expect(launches).toHaveLength(2)
  const fork = launches[1]!
  const i = fork.indexOf('--resume')
  expect(fork.slice(i, i + 3)).toEqual(['--resume', 's-main', '--fork-session'])
  const first = textOf(chatRuns(werk)[1]!.inputs[0])
  expect(first).toContain('home card is #werk-mc-fork')
})

test('102.2 Shift+click on a card that already has a tab switches to that tab', async ({ page, werk }) => {
  const p = await twoTabs(page, werk)
  const tabPosts: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/tabs')) tabPosts.push(r.url())
  })
  const before = werk.agentLaunches().length
  await p.linkTo('werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.tabs.nth(1)).toHaveText('#werk-mc-fork')
  await expect(p.tabs).toHaveCount(2)
  await page.waitForTimeout(500)
  expect(tabPosts).toEqual([])
  expect(werk.agentLaunches().length).toBe(before)
})

test('102.3 A plain click moves the map and keeps the current conversation', async ({ page, werk }) => {
  const p = await twoTabs(page, werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await p.linkTo('werk-mc-split').click()
  await expect(p.card).toHaveAttribute('data-card-id', 'werk-mc-split')
  await expect(p.tabs.nth(0)).toHaveText('#root')
  await expect(p.tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(p.tabs).toHaveCount(2)

  const sent = page.waitForRequest((r) => r.url().endsWith('/api/chat'))
  await p.composer.fill('Hello there')
  await p.composer.press('Enter')
  const body = (await sent).postDataJSON() as { tab: string; card: string }
  expect(body.tab).toBe('main')
  expect(body.card).toBe('werk-mc-split')
  await expect(p.transcript).toContainText('Ok.')
  const runs = chatRuns(werk)
  expect(runs).toHaveLength(1)
  expect(textOf(runs[0]!.inputs[0]).split('\n')[0]).toContain('#werk-mc-split')
})

test("102.4 The '+' forks at the open card and the empty-conversation control starts with no parent", async ({ page, werk }) => {
  addCards(werk, 'root', CHILDREN)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await openAt(page, werk, 'root')
  const p = parts(page)
  await p.composer.fill('Main')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('Ok.')
  await p.linkTo('werk-mc-tabs').click()
  await expect(p.card).toHaveAttribute('data-card-id', 'werk-mc-tabs')

  await p.chat.getByRole('button', { name: 'Fork at the open card' }).click()
  await expect(p.tabs).toHaveCount(2)
  await expect(p.tabs.nth(1)).toHaveText('#werk-mc-tabs')
  await expect(p.tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(p.card).toHaveAttribute('data-card-id', 'werk-mc-tabs')
  // The launch record exists once the conversation's agent starts, at its first message.
  await p.composer.fill('Forked')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('Ok.')
  await expect.poll(() => werk.agentLaunches().length).toBe(2)
  const forked = werk.agentLaunches()[1]!
  const i = forked.indexOf('--resume')
  expect(forked.slice(i, i + 3)).toEqual(['--resume', 's-main', '--fork-session'])

  await page.goto(`${werk.url}#werk-onechat`)
  await expect(p.card).toHaveAttribute('data-card-id', 'werk-onechat')
  await p.chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(p.tabs).toHaveCount(3)
  await expect(p.tabs.nth(2)).toHaveText('#werk-onechat')
  await expect(p.tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  await p.composer.fill('Unrelated')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('Ok.')
  await expect.poll(() => werk.agentLaunches().length).toBe(3)
  const empty = werk.agentLaunches()[2]!
  expect(empty).not.toContain('--resume')
  expect(empty).not.toContain('--fork-session')
})

test('102.5 The tab strip is the last row of the pane and starts at its left edge', async ({ page, werk }) => {
  addCards(werk, 'root', CHILDREN)
  await openAt(page, werk, 'root')
  const p = parts(page)
  await page.goto(`${werk.url}#werk-mc-fork`)
  await p.chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(p.tabs).toHaveCount(2)

  const pane = (await p.chat.boundingBox())!
  const composer = (await p.composer.boundingBox())!
  const strip = (await p.chat.getByRole('tablist', { name: 'conversations' }).locator('..').boundingBox())!
  expect(strip.y).toBeGreaterThanOrEqual(composer.y + composer.height - 1)
  // Nothing visible in the pane is drawn below the strip.
  const lowest = await p.chat.evaluate((el) => {
    let max = 0
    for (const child of el.querySelectorAll('*')) {
      const r = child.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) max = Math.max(max, r.bottom)
    }
    return max
  })
  expect(lowest).toBeLessThanOrEqual(strip.y + strip.height + 1)
  expect(Math.abs(strip.y + strip.height - (pane.y + pane.height))).toBeLessThanOrEqual(1)
  const borderLeft = await p.chat.evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth) || 0)
  const chip = (await p.tabs.first().boundingBox())!
  expect(chip.x - (pane.x + borderLeft)).toBeLessThanOrEqual(0.5)
  for (const [i, label] of ['#root', '#werk-mc-fork'].entries()) {
    await expect(p.tabs.nth(i)).toHaveText(label)
    await expect(p.tabs.nth(i).locator('.dot')).toBeVisible()
  }
})
