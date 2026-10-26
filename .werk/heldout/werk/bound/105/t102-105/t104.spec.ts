/** Held-out steps 104.1 to 104.5: parking tabs, the '…' menu, the close control and the idle reap. */
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { addCards, alive, navigate, openAppAt, parts, reply, send, STANDARD } from './helpers.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Opens the app at the first card, then one empty conversation at each next card, in order. */
async function openTabs(page: Page, werk: Werk, cards: string[]) {
  const { chat } = parts(page)
  await openAppAt(page, werk, cards[0]!)
  for (const card of cards.slice(1)) await openOne(page, werk, card)
  void chat
}
async function openOne(page: Page, werk: Werk, card: string) {
  const { chat } = parts(page)
  await navigate(page, werk, card)
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(chat.getByRole('tab', { name: `#${card}` })).toHaveAttribute('aria-selected', 'true')
}

test('104.1 A sixth conversation parks the least recently touched idle tab', async ({ page, werk }) => {
  addCards(werk, STANDARD)
  await openTabs(page, werk, ['alpha', 'beta', 'gamma', 'werk-mc-fork', 'werk-mc-split'])
  const { chips, chat, more, menu } = parts(page)
  await expect(chips).toHaveText(['#alpha', '#beta', '#gamma', '#werk-mc-fork', '#werk-mc-split'])
  await openOne(page, werk, 'werk-mc-tabs')
  await expect(chips).toHaveCount(5)
  await expect(chat.getByRole('tab', { name: '#werk-mc-tabs' })).toBeVisible()
  await expect(chat.getByRole('tab', { name: '#alpha' })).toHaveCount(0)
  await more.click()
  await expect(menu.getByRole('menuitem', { name: /#alpha/ })).toHaveAttribute('data-mark', 'parked')
  await expect(menu.getByRole('menuitem', { name: /#alpha/ })).toContainText('parked')
})

test('104.2 A tab with a running turn is never parked', async ({ page, werk }) => {
  addCards(werk, STANDARD)
  const gate = join(werk.dir, 'release-104-2')
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Done.', [{ waitFor: gate }])] } })
  await openAppAt(page, werk, 'alpha')
  const { chips, chat, more, menu } = parts(page)
  await send(page, 'Take your time')
  await expect(chips.first()).toHaveAttribute('data-state', 'running')
  for (const card of ['beta', 'gamma', 'werk-mc-fork', 'werk-mc-split']) await openOne(page, werk, card)
  await expect(chips).toHaveCount(5)
  await openOne(page, werk, 'werk-mc-tabs')
  await expect(chips).toHaveCount(5)
  await expect(chat.getByRole('tab', { name: '#alpha' })).toBeVisible()
  await expect(chat.getByRole('tab', { name: '#alpha' })).toHaveAttribute('data-state', 'running')
  await expect(chat.getByRole('tab', { name: '#alpha' }).locator('.dot')).toBeVisible()
  await expect(chat.getByRole('tab', { name: '#beta' })).toHaveCount(0)
  await more.click()
  await expect(menu.getByRole('menuitem', { name: /#beta/ })).toHaveAttribute('data-mark', 'parked')
  writeFileSync(gate, '')
})

test("104.3 The '…' menu lists every conversation and un-parks one with a resume", async ({ page, werk }) => {
  addCards(werk, STANDARD)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('One.'), reply('Two.')] } })
  await openAppAt(page, werk, 'alpha')
  const { chips, chat, more, menu, transcript } = parts(page)
  await send(page, 'Earlier note')
  await expect(transcript).toContainText('One.')
  for (const card of ['beta', 'gamma', 'werk-mc-fork', 'werk-mc-split', 'werk-mc-tabs']) await openOne(page, werk, card)
  await expect(chips).toHaveCount(5)
  await expect(chat.getByRole('tab', { name: '#alpha' })).toHaveCount(0)

  await expect(more).toContainText('6')
  await more.click()
  const rows = menu.getByRole('menuitem')
  await expect(rows).toHaveCount(6)
  await expect(menu.locator('[data-mark="visible"]')).toHaveCount(5)
  await expect(menu.locator('[data-mark="parked"]')).toHaveCount(1)
  await expect(menu.getByRole('menuitem', { name: /#alpha/ })).toHaveAttribute('data-mark', 'parked')
  await expect(menu.getByRole('menuitem', { name: /#werk-mc-tabs/ })).toHaveAttribute('aria-current', 'true')
  await expect(menu.getByRole('menuitem', { name: /#werk-mc-tabs/ })).toContainText('active')

  await menu.getByRole('menuitem', { name: /#gamma/ }).click()
  await expect(chat.getByRole('tab', { name: '#gamma' })).toHaveAttribute('aria-selected', 'true')

  const launchesBefore = werk.agentLaunches().length
  await more.click()
  await menu.getByRole('menuitem', { name: /#alpha/ }).click()
  await expect(chat.getByRole('tab', { name: '#alpha' })).toBeVisible()
  await expect(chat.getByRole('tab', { name: '#alpha' })).toHaveAttribute('aria-selected', 'true')
  // Least recently touched idle tab now: #beta (alpha was touched by its message before beta opened).
  await expect(chat.getByRole('tab', { name: '#beta' })).toHaveCount(0)
  await more.click()
  await expect(menu.getByRole('menuitem', { name: /#beta/ })).toHaveAttribute('data-mark', 'parked')
  await page.keyboard.press('Escape')

  const resumed = await expect
    .poll(() => werk.agentLaunches().length, { timeout: 5_000 })
    .toBe(launchesBefore + 1)
    .then(() => true)
    .catch(() => false)
  expect.soft(resumed, 'the un-park starts an agent').toBe(true)
  if (resumed) {
    const l = werk.agentLaunches().at(-1)!
    expect.soft(l.slice(l.indexOf('--resume'), l.indexOf('--resume') + 2)).toEqual(['--resume', 's-main'])
  }
  await expect(transcript).toContainText('Earlier note')
  await send(page, 'Later note')
  await expect(transcript.getByRole('listitem').last()).toContainText(/One\.|Two\./)
  for (const l of werk.agentLaunches()) expect(l).not.toContain('--fork-session')
  console.log('DIAG 104.3 launches', JSON.stringify(werk.agentLaunches().map((l) => l.filter((a) => a === '--resume' || a.startsWith('s-')))))
})

test('104.4 The close control parks a tab and does not end the conversation', async ({ page, werk }) => {
  addCards(werk, STANDARD)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Second says hi.')] } })
  await openTabs(page, werk, ['alpha', 'beta', 'gamma'])
  const { chips, chat, more, menu, transcript } = parts(page)
  // The second conversation has an earlier transcript.
  await chips.nth(1).click()
  await send(page, 'Hello second')
  await expect(transcript).toContainText('Second says hi.')
  await expect(chips).toHaveText(['#alpha', '#beta', '#gamma'])

  await chips.nth(1).hover()
  await chat.getByRole('button', { name: 'Close #beta' }).click()
  await expect(chips).toHaveText(['#alpha', '#gamma'])
  await expect(more).toContainText('3')
  await more.click()
  await expect(menu.getByRole('menuitem')).toHaveCount(3)
  await expect(menu.getByRole('menuitem', { name: /#beta/ })).toHaveAttribute('data-mark', 'parked')
  await menu.getByRole('menuitem', { name: /#beta/ }).click()
  await expect(chat.getByRole('tab', { name: '#beta' })).toHaveAttribute('aria-selected', 'true')
  await expect(transcript).toContainText('Hello second')
  await expect(transcript).toContainText('Second says hi.')
})

test.describe('with an idle limit of milliseconds', () => {
  test.use({ werkEnv: { WERK_IDLE_MS: '200', WERK_IDLE_CHECK_MS: '50' } })

  test("104.5 An idle parked session's process is killed and resumes when reopened", async ({ page, werk }) => {
    addCards(werk, STANDARD)
    werk.scriptAgent({ steps: [], roles: { chat: [reply('One.')] } })
    await openAppAt(page, werk, 'alpha')
    const { chips, chat, more, menu, transcript } = parts(page)
    await send(page, 'Remember this')
    await expect(transcript).toContainText('One.')
    await openOne(page, werk, 'beta')
    await chips.first().hover()
    await chat.getByRole('button', { name: 'Close #alpha' }).click()
    await expect(chips).toHaveText(['#beta'])

    const first = werk.agentRuns()[0]!.pid
    await expect.poll(() => alive(first)).toBe(false)
    await more.click()
    await expect(menu.getByRole('menuitem', { name: /#alpha/ })).toHaveAttribute('data-mark', 'parked')
    await menu.getByRole('menuitem', { name: /#alpha/ }).click()
    await expect.poll(() => werk.agentLaunches().length).toBe(2)
    const resumed = werk.agentLaunches()[1]!
    expect(resumed.slice(resumed.indexOf('--resume'), resumed.indexOf('--resume') + 2)).toEqual(['--resume', 's-main'])
    expect(resumed).not.toContain('--fork-session')

    await send(page, 'What was it?')
    await expect(transcript.getByRole('listitem')).toHaveCount(2)
    await expect(transcript.getByRole('listitem').last()).toContainText('One.')
    expect(werk.agentLaunches()).toHaveLength(2)
  })
})
