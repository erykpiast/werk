/** Held-out steps 102.1 to 102.5: forking tabs from the map, and the tab strip. */
import { expect, test } from '../../e2e/harness.ts'
import { addCards, chatRuns, navigate, openAppAt, parts, reply, send, STANDARD, textOf } from './helpers.ts'

const treeLink = (page: import('@playwright/test').Page, id: string) =>
  page.getByRole('list', { name: 'sub-cards' }).locator(`li[data-card-id="${id}"] > a`)

test('102.1 Shift+click on a card forks a new conversation rooted there and focuses it', async ({ page, werk }) => {
  addCards(werk, STANDARD)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('One.')] } })
  // Given one conversation in a tab, which has finished one turn, and the map shows #root.
  await openAppAt(page, werk, 'root')
  const { chips, transcript, card } = parts(page)
  await expect(chips).toHaveCount(1)
  await send(page, 'First')
  await expect(transcript).toContainText('One.')
  await expect(chips.first()).toHaveAttribute('data-state', 'idle')

  // When Shift+click #werk-mc-fork on the map.
  await treeLink(page, 'werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(1)).toHaveText('#werk-mc-fork')
  await expect(chips.nth(1).locator('.dot')).toBeVisible()
  await expect(chips.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(card).toHaveAttribute('data-card-id', 'werk-mc-fork')
  // The launch record for the new conversation, before any message is sent in it.
  const before = await expect
    .poll(() => werk.agentLaunches().length, { timeout: 5_000 })
    .toBe(2)
    .then(() => 'launched')
    .catch(() => 'no launch')
  expect.soft(before, 'the new conversation has a launch record before its first message').toBe('launched')

  // When the person sends a message in the new tab.
  await send(page, 'Branch')
  await expect.poll(() => chatRuns(werk).length).toBe(2)
  const fork = werk.agentLaunches()[1]!
  const at = fork.indexOf('--resume')
  expect(fork.slice(at, at + 3)).toEqual(['--resume', 's-main', '--fork-session'])
  await expect.poll(() => chatRuns(werk)[1]!.inputs.length).toBeGreaterThan(0)
  expect(textOf(chatRuns(werk)[1]!.inputs[0])).toContain('home card is #werk-mc-fork')
})

/** Two tabs: #werk-mc-fork (opened first) and #root, with #root active and the map at #root. */
async function twoTabs(page: import('@playwright/test').Page, werk: import('../../e2e/harness.ts').Werk) {
  addCards(werk, STANDARD)
  await openAppAt(page, werk, 'werk-mc-fork')
  await navigate(page, werk, 'root')
  const { chat, chips } = parts(page)
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(chips).toHaveText(['#werk-mc-fork', '#root'])
  await expect(chat.getByRole('tab', { name: '#root' })).toHaveAttribute('aria-selected', 'true')
  await expect(parts(page).card).toHaveAttribute('data-card-id', 'root')
}

test('102.2 Shift+click on a card that already has a tab switches to that tab', async ({ page, werk }) => {
  await twoTabs(page, werk)
  const { chat, chips } = parts(page)
  const launches = werk.agentLaunches().length
  await treeLink(page, 'werk-mc-fork').click({ modifiers: ['Shift'] })
  await expect(chat.getByRole('tab', { name: '#werk-mc-fork' })).toHaveAttribute('aria-selected', 'true')
  await expect(chips).toHaveCount(2)
  expect(werk.agentLaunches().length).toBe(launches)
})

test('102.3 A plain click moves the map and keeps the current conversation', async ({ page, werk }) => {
  await twoTabs(page, werk)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  const { chat, chips, transcript, card } = parts(page)
  const rootTab = await chat.getByRole('tab', { name: '#root' }).getAttribute('data-tab')
  await treeLink(page, 'werk-mc-split').click()
  await expect(card).toHaveAttribute('data-card-id', 'werk-mc-split')
  await expect(chat.getByRole('tab', { name: '#root' })).toHaveAttribute('aria-selected', 'true')
  await expect(chips).toHaveCount(2)

  await send(page, 'Where are we?')
  await expect(transcript).toContainText('Ok.')
  await expect(chat).toHaveAttribute('data-tab', rootTab!)
  await expect.poll(() => chatRuns(werk).length).toBe(1)
  await expect.poll(() => chatRuns(werk)[0]!.inputs.length).toBeGreaterThan(0)
  const first = textOf(chatRuns(werk)[0]!.inputs[0])
  expect(first.split('\n')[0]).toContain('#werk-mc-split')
  // The #werk-mc-fork tab got no turn.
  await chips.first().click()
  await expect(transcript.getByRole('listitem')).toHaveCount(0)
})

test("102.4 The '+' forks at the open card and the empty-conversation control starts with no parent", async ({ page, werk }) => {
  addCards(werk, STANDARD)
  werk.scriptAgent({ steps: [], roles: { chat: [reply('Ok.')] } })
  await openAppAt(page, werk, 'root')
  const { chat, chips, transcript, card } = parts(page)
  await send(page, 'Main')
  await expect(transcript).toContainText('Ok.')
  await navigate(page, werk, 'werk-mc-tabs')

  await chat.getByRole('button', { name: 'Fork at the open card' }).click()
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(1)).toHaveText('#werk-mc-tabs')
  await expect(chips.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(card).toHaveAttribute('data-card-id', 'werk-mc-tabs')
  const forked = await expect
    .poll(() => werk.agentLaunches().length, { timeout: 5_000 })
    .toBe(2)
    .then(() => true)
    .catch(() => false)
  expect.soft(forked, 'the forked conversation has a launch record').toBe(true)
  if (forked) {
    const l = werk.agentLaunches()[1]!
    expect.soft(l.slice(l.indexOf('--resume'), l.indexOf('--resume') + 3)).toEqual(['--resume', 's-main', '--fork-session'])
  }

  await navigate(page, werk, 'werk-onechat')
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(chips).toHaveCount(3)
  await expect(chips.nth(2)).toHaveText('#werk-onechat')
  await expect(chips.nth(2)).toHaveAttribute('aria-selected', 'true')
  const launched = await expect
    .poll(() => werk.agentLaunches().length, { timeout: 5_000 })
    .toBe(forked ? 3 : 2)
    .then(() => true)
    .catch(() => false)
  expect.soft(launched, 'the empty conversation has a launch record').toBe(true)
  if (launched) {
    const l = werk.agentLaunches().at(-1)!
    expect(l).not.toContain('--resume')
    expect(l).not.toContain('--fork-session')
  }
  // Diagnostic only, after the step's checks: a message in each new tab, to show what its launch holds then.
  if (!forked) {
    await chips.nth(1).click()
    await send(page, 'Diag fork')
    await chips.nth(2).click()
    await send(page, 'Diag empty')
    await expect.poll(() => werk.agentLaunches().length).toBe(3)
    console.log('DIAG launches after messages:', JSON.stringify(werk.agentLaunches().map((l) => l.filter((a) => a === '--resume' || a === '--fork-session' || a.startsWith('s-')))))
  }
})

test('102.5 The tab strip is the last row of the pane and starts at its left edge', async ({ page, werk }) => {
  addCards(werk, STANDARD)
  await openAppAt(page, werk, 'root')
  const { chat, chips } = parts(page)
  await navigate(page, werk, 'alpha')
  await chat.getByRole('button', { name: 'New empty conversation' }).click()
  await expect(chips).toHaveCount(2)

  const geo = await chat.evaluate((pane) => {
    const strip = pane.querySelector('.tabstrip')!
    const s = strip.getBoundingClientRect()
    const p = pane.getBoundingClientRect()
    const composer = pane.querySelector('textarea')!.getBoundingClientRect()
    const firstChip = pane.querySelector('[role="tab"]')!.getBoundingClientRect()
    const below = [...pane.querySelectorAll('*')]
      .filter((el) => !strip.contains(el))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && r.bottom > s.top + 0.5)
    return {
      stripTop: s.top,
      stripBottom: s.bottom,
      paneBottom: p.bottom,
      paneInnerLeft: p.left + pane.clientLeft,
      composerBottom: composer.bottom,
      chipLeft: firstChip.left,
      below: below.length,
    }
  })
  expect(geo.stripTop).toBeGreaterThanOrEqual(geo.composerBottom - 0.5)
  expect(Math.abs(geo.stripBottom - geo.paneBottom)).toBeLessThanOrEqual(0.5)
  expect(geo.below).toBe(0)
  expect(Math.abs(geo.chipLeft - geo.paneInnerLeft)).toBeLessThanOrEqual(0.5)
  for (const chip of await chips.all()) {
    await expect(chip).toHaveText(/^#[\w-]+$/)
    await expect(chip.locator('.dot')).toBeVisible()
  }
})
