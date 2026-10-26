/** Steps 102.1 - 102.5: the conversation tab strip, Shift+click forks, '+' and the empty control. */
import { expect, test, type Werk } from '../../e2e/harness.ts'
import type { Page } from '@playwright/test'
import { addCard, parts, reply, textOf } from './common.ts'

const chatRuns = (werk: Werk) => werk.agentRuns().filter((r) => r.role === 'chat')
/** The card links on the open card's view: the sub-cards under the open card. */
const cardLink = (page: Page, id: string) => page.locator(`a[href="#${id}"]`).first()

/** The map with a root card and the cards the steps name under it. */
const seed = (werk: Werk) => {
  addCard(werk, 'root', 'werk', 'The root of the steps')
  for (const id of ['werk-mc-fork', 'werk-mc-split', 'werk-mc-tabs', 'werk-onechat']) addCard(werk, id, 'root')
}

/** The person opens the app at a card's address: a fresh page load, not a hash change on the page the harness opened. */
const openAt = async (page: Page, werk: Werk, id: string) => {
  await page.goto('about:blank')
  await page.goto(`${werk.url}#${id}`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
}

/** Opens the app at #root and gives the root conversation one finished turn, so it has a session. */
const rootWithSession = async (page: Page, werk: Werk) => {
  await openAt(page, werk, 'root')
  const p = parts(page)
  await p.composer.fill('First')
  await p.composer.press('Enter')
  await expect(p.transcript).toContainText('One.')
  return p
}

test('102.1 Shift+click on a card forks a new conversation rooted there and focuses it', async ({ page, werk }) => {
  seed(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('One.', 's-first'), reply('Two.', 's-first')] } })
  const { tabs, composer } = await rootWithSession(page, werk)
  await expect(tabs).toHaveCount(1)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'root')

  await cardLink(page, 'werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveText('#werk-mc-fork')
  await expect(tabs.nth(1).locator('.dot')).toBeAttached()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-mc-fork')
  // The launch record for the new conversation, read right after the Shift+click, before any message.
  await expect
    .soft(() => {
      const launches = werk.agentLaunches()
      expect(launches).toHaveLength(2)
      const fork = launches[1]!
      const at = fork.indexOf('--resume')
      expect(fork.slice(at, at + 3)).toEqual(['--resume', 's-first', '--fork-session'])
    }, 'a launch record for the new conversation exists before its first message')
    .toPass({ timeout: 3000 })

  await composer.fill('Branch')
  await composer.press('Enter')
  await expect.poll(() => chatRuns(werk).length).toBe(2)
  await expect.poll(() => chatRuns(werk)[1]!.inputs.length).toBe(1)
  const fork = werk.agentLaunches()[1]!
  const at = fork.indexOf('--resume')
  console.log('102.1 launch after the message:', JSON.stringify(fork.slice(at, at + 3)))
  expect(fork.slice(at, at + 3)).toEqual(['--resume', 's-first', '--fork-session'])
  const first = textOf(chatRuns(werk)[1]!.inputs[0])
  expect(first).toMatch(/\[this conversation is a new tab, and its home card is #werk-mc-fork\b/)
})

/** Two tabs, "#root" active and "#werk-mc-fork". */
const twoTabs = async (page: Page, werk: Werk) => {
  seed(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('One.', 's-first'), reply('Two.', 's-first')] } })
  const p = await rootWithSession(page, werk)
  await cardLink(page, 'werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(p.tabs).toHaveText(['#root', '#werk-mc-fork'])
  await p.chat.getByRole('tab', { name: '#root' }).click()
  await expect(p.tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'root')
  return p
}

test('102.2 Shift+click on a card that already has a tab switches to that tab', async ({ page, werk }) => {
  const { tabs } = await twoTabs(page, werk)
  const launchesBefore = werk.agentLaunches().length
  const tabRequests: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/tabs')) tabRequests.push(r.postData() ?? '')
  })
  await cardLink(page, 'werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs).toHaveCount(2)
  expect(werk.agentLaunches()).toHaveLength(launchesBefore)
  expect(tabRequests).toEqual([])
})

test('102.3 a plain click moves the map and keeps the current conversation', async ({ page, werk }) => {
  const { tabs, composer, chat } = await twoTabs(page, werk)
  await cardLink(page, 'werk-mc-split').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-mc-split')
  await expect(tabs.nth(0)).toHaveText('#root')
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs).toHaveCount(2)
  await expect(chat).toHaveAttribute('data-tab', 'main')

  await composer.fill('Next')
  await composer.press('Enter')
  // The root conversation is the first chat launch, the one with a turn already.
  await expect.poll(() => chatRuns(werk)[0]!.inputs.length).toBe(2)
  expect(chatRuns(werk)).toHaveLength(1)
  const turn = textOf(chatRuns(werk)[0]!.inputs[1])
  expect(turn.split('\n')[0]).toMatch(/^\[the map is now at #werk-mc-split\b/)
})

test("102.4 the '+' forks at the open card and the empty-conversation control starts with no parent", async ({ page, werk }) => {
  seed(werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('One.', 's-first')] } })
  await openAt(page, werk, 'root')
  const { chat, tabs, composer, transcript } = parts(page)
  await composer.fill('First')
  await composer.press('Enter')
  await expect(transcript).toContainText('One.')
  await cardLink(page, 'werk-mc-tabs').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-mc-tabs')

  await chat.getByRole('button', { name: 'Fork at the open card' }).click()
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveText('#werk-mc-tabs')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-mc-tabs')
  await expect
    .soft(() => {
      const launches = werk.agentLaunches()
      expect(launches).toHaveLength(2)
      expect(launches[1]).toEqual(expect.arrayContaining(['--resume', 's-first', '--fork-session']))
    }, "a launch record for the '+' conversation exists before its first message")
    .toPass({ timeout: 3000 })

  await page.goto(`${werk.url}#werk-onechat`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'werk-onechat')
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(tabs).toHaveCount(3)
  await expect(tabs.nth(2)).toHaveText('#werk-onechat')
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect
    .soft(() => {
      const launches = werk.agentLaunches()
      expect(launches.length).toBeGreaterThanOrEqual(2)
      const empty = launches.at(-1)!
      expect(empty).not.toContain('--resume')
      expect(empty).not.toContain('--fork-session')
    }, 'a launch record for the empty conversation exists, with no parent and no fork option')
    .toPass({ timeout: 3000 })
  console.log('102.4 launches:', werk.agentLaunches().map((a) => a.filter((x) => x === '--resume' || x === '--fork-session' || x.startsWith('s-')).join(' ')))
})

test('102.5 the tab strip is the last row of the pane and starts at its left edge', async ({ page, werk }) => {
  seed(werk)
  await openAt(page, werk, 'root')
  const { chat, tabs, composer } = parts(page)
  await cardLink(page, 'werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(tabs).toHaveCount(2)

  const pane = (await chat.boundingBox())!
  const box = (await composer.boundingBox())!
  const strip = (await chat.getByRole('tablist', { name: 'conversations' }).locator('..').boundingBox())!
  const first = (await tabs.first().boundingBox())!
  expect(strip.y).toBeGreaterThanOrEqual(box.y + box.height - 1)
  // Nothing in the pane is drawn below the strip.
  const lowest = await chat.evaluate((el) => {
    let bottom = 0
    for (const node of el.querySelectorAll('*')) {
      const r = node.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom)
    }
    return bottom
  })
  expect(lowest).toBeLessThanOrEqual(strip.y + strip.height + 0.5)
  expect(Math.abs(strip.y + strip.height - (pane.y + pane.height))).toBeLessThanOrEqual(1)
  // The pane draws a 1px border on its left edge; the chip starts right after it.
  expect(first.x - pane.x).toBeLessThanOrEqual(1)
  for (const tab of await tabs.all()) {
    await expect(tab).toHaveText(/^#[\w-]+$/)
    await expect(tab.locator('.dot')).toBeVisible()
  }
})
