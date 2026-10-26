/** Held-out steps 81.1-81.5 and 90.1-90.5: the board view, its drawer, and the pulse and live log of a build. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../e2e/harness.ts'

const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const COLUMNS = ['blocked', 'ready', 'building', 'merging', 'done']

let seq = 100
const boardEvent = (werk: Werk, type: string, payload: object) =>
  appendFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    JSON.stringify({ seq: seq++, at: new Date().toISOString(), actor: 'agent', type, payload }) + '\n',
  )

const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

const pulses = async (page: Page, n: number) => {
  await expect(card(page, n)).toHaveAttribute('data-live', 'true')
  expect(await card(page, n).evaluate((el) => getComputedStyle(el).animationName)).toBe('pulse')
}
const doesNotPulse = async (page: Page, n: number) => {
  await expect(card(page, n)).not.toHaveAttribute('data-live', 'true')
  expect(await card(page, n).evaluate((el) => getComputedStyle(el).animationName)).not.toBe('pulse')
}

/** Commits a Makefile to the main line of the test project, so a build's checks run it. */
const commitMakefile = (werk: Werk, text: string) => {
  writeFileSync(join(werk.dir, 'Makefile'), text)
  for (const args of [['add', 'Makefile'], ['commit', '--quiet', '-m', 'checks']]) {
    const r = spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
    if (r.status !== 0) throw new Error(r.stderr)
  }
}

test('81.1 every fixture ticket shows in the column its last event names', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('section.column')).toHaveCount(5)
  expect(await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(COLUMNS)
  const expected: [string, number[]][] = [
    ['blocked', [4]],
    ['ready', [3, 6]],
    ['building', [2]],
    ['merging', [5]],
    ['done', [1]],
  ]
  for (const [name, numbers] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  for (const n of [1, 2, 3, 4, 5, 6]) await expect(card(page, n)).toHaveCount(1)
  // Ticket 5 moved to building and then to merging.
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toBeVisible()
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await openBoard(page)
  // Ticket 2 retried two times; ticket 3 retried one time.
  await expect(card(page, 2).getByRole('link').first()).toHaveText('Draw the map in a browser')
  await expect(card(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(card(page, 3).getByRole('link').first()).toHaveText('Open a card from the address bar')
  await expect(card(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = (await card(page, n).innerText()).toLowerCase()
    expect(text).not.toContain('what to build')
    expect(text).not.toContain('acceptance criteria')
    expect(text).not.toContain('make test')
    expect(text).not.toContain('make e2e')
    expect(text).not.toContain('#map')
    expect(text).not.toContain('map-hash')
  }
})

test('81.3 a ticket counts only the blockers that are not done', async ({ page, werk }) => {
  // Ticket 7 is blocked by ticket 1, in done, and ticket 6, in ready.
  boardEvent(werk, 'ticket.planned', {
    number: 7,
    title: 'Wait for two tickets',
    cites: ['map'],
    blockedBy: [1, 6],
    stories: [1],
    touches: ['map view'],
    checks: ['make test'],
    brief: '## What to build\n\nWait.\n\n## Acceptance criteria\n\n- [ ] It waits.',
  })
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(card(page, 7).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(card(page, 7).locator('[data-badge="blockers"]')).not.toContainText('2')
  // Ticket 6 has no blockers.
  await expect(card(page, 6).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer under the board with the slice and its metadata', async ({ page, werk }) => {
  const brief =
    '## What to build\n\n' +
    Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the long brief explains one more part of the work in plain words.`).join('\n\n') +
    '\n\n## Acceptance criteria\n\n- [ ] The last line of the long brief shows.'
  boardEvent(werk, 'ticket.planned', {
    number: 8,
    title: 'A ticket with a long brief',
    cites: ['map-hash', 'fold'],
    blockedBy: [2],
    stories: [2],
    touches: ['map view'],
    checks: ['make test', 'make e2e'],
    brief,
  })
  boardEvent(werk, 'ticket.retried', { number: 8 })
  boardEvent(werk, 'ticket.retried', { number: 8 })
  await openBoard(page)
  await card(page, 8).getByRole('link').first().click()

  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = page.locator('.board')
  const boardBox = (await board.boundingBox())!
  const drawerBox = (await drawer.boundingBox())!
  expect(drawerBox.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height)

  const slice = drawer.getByRole('article', { name: 'slice' })
  const metadata = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('Paragraph 1 of the long brief')
  await expect(slice).toContainText('Paragraph 12 of the long brief')
  await expect(slice).toContainText('The last line of the long brief shows.')
  expect((await slice.boundingBox())!.x).toBeLessThan((await metadata.boundingBox())!.x)

  await expect(metadata).toContainText('#map-hash')
  await expect(metadata).toContainText('#fold')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText(/retries\s*2/)
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make test')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make e2e')

  for (const name of COLUMNS) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  await expect(card(page, 4)).toBeVisible()
  const before: Record<string, string[]> = {}
  for (const name of COLUMNS) {
    before[name] = await column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')!))
  }
  // Ticket 3 cites #map-hash, a card on the map.
  await card(page, 3).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await drawer.getByRole('complementary', { name: 'metadata' }).getByRole('link', { name: '#map-hash' }).click()

  await expect(page).toHaveURL(/#map-hash$/)
  await expect(page.locator('.board')).toHaveCount(0)
  await expect(page.getByText('The open card lives in the location hash').first()).toBeVisible()
  await expect(page.getByText('The address bar names the open card.').first()).toBeVisible()

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('section.column')).toHaveCount(5)
  expect(await page.locator('section.column').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(COLUMNS)
  for (const name of COLUMNS) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(before[name]!.length)
    for (const n of before[name]!) await expect(column(page, name).locator(`li[data-ticket="${n}"]`)).toBeVisible()
  }
})

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working.'), { sleep: 4000 }, { event: { type: 'result', subtype: 'success' } }], exit: 0 } } })
  await openBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  const build = werk.start(['build', '6', '--cap', '1'])

  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await pulses(page, 6)
  await build.exited
  await doesNotPulse(page, 6)
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  const steps: object[] = []
  for (let i = 1; i <= 20; i++) steps.push(said(`Event number ${i}.`), { sleep: 1000 })
  werk.scriptAgent({ steps: [], roles: { builder: { steps, exit: 0 } } })
  await openBoard(page)
  werk.start(['build', '6', '--cap', '1'])

  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await column(page, 'building').locator('li[data-ticket="6"]').getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const boardBox = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height)

  const log = drawer.getByRole('region', { name: 'agent log' })
  const slice = drawer.getByRole('article', { name: 'slice' })
  await expect(log).toContainText('Event number 1.')
  expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  const lines = log.locator('ol')
  const height = (await lines.boundingBox())!.height

  await expect(log).toContainText('Event number 2.')
  await expect(log).toContainText('Event number 18.', { timeout: 30_000 })
  expect((await lines.boundingBox())!.height).toBe(height)
  const overflow = await lines.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(overflow).toBe(true)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  const gate = join(werk.dir, '..', 'exit-now')
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: gate }], exit: 0 } } })
  await openBoard(page)
  const build = werk.start(['build', '6', '--cap', '1'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await card(page, 6).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer.getByRole('region', { name: 'agent log' })).toContainText('Building.')

  writeFileSync(gate, '')
  await build.exited
  // The merge loop moves the ticket into merging once its pass ends.
  boardEvent(werk, 'ticket.moved', { number: 6, to: 'merging' })

  await expect(column(page, 'merging').locator('li[data-ticket="6"]')).toBeVisible()
  await doesNotPulse(page, 6)
  await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
  await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
  await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  // The project's checks take a few seconds and fail, so the wait before the next attempt shows.
  commitMakefile(werk, 'test:\n\tsleep 6\n\texit 1\ne2e:\n\texit 1\n')
  werk.scriptAgent({
    steps: [],
    roles: {
      builder: [
        { steps: [said('First pass.'), { sleep: 2000 }], exit: 1 },
        { steps: [said('Second pass.'), { waitFor: join(werk.dir, '..', 'never') }], exit: 0 },
      ],
    },
  })
  await openBoard(page)
  werk.start(['build', '6', '--cap', '2'])

  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await pulses(page, 6)
  await doesNotPulse(page, 6)
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: join(werk.dir, '..', 'never') }], exit: 0 } } })
  await openBoard(page)
  werk.start(['build', '6', '--cap', '1'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await pulses(page, 6)

  // By hand: the person drags the building ticket back into ready.
  await card(page, 6).dragTo(column(page, 'ready'))
  await doesNotPulse(page, 6)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  await card(page, 6).getByRole('link').first().click()
  await expect(page.getByRole('region', { name: 'drawer' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})
