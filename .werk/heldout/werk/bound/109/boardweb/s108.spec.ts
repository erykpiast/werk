import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import {
  alive,
  branches,
  card,
  column,
  gate,
  inColumn,
  killAll,
  moved,
  openBoard,
  planned,
  prepareRepo,
  pulses,
  ROOT,
  said,
  scriptRun,
  sessionPid,
  writeBoard,
} from './helpers.ts'

test.afterEach(async ({ werk }) => {
  killAll(werk)
  await new Promise((r) => setTimeout(r, 1_000))
})

const archiveButton = (page: Page, n: number) => card(page, n).getByRole('button', { name: /archive/i })

/** An active run whose builder of ticket 1 runs and never ends by itself. */
async function buildingRun(page: Page, werk: Werk) {
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'Long build' })])
  scriptRun(werk, { steps: [said('Building.'), { edit: { path: 'b.txt', content: 'b\n' } }, { waitFor: gate(werk, 'never') }] })
  werk.start(['run', ROOT])
  await openBoard(page)
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  await pulses(page, 1)
  await expect.poll(() => alive(sessionPid(werk, 1))).toBe(true)
  return sessionPid(werk, 1)!
}

test('108.1 only ready, blocked, and building tickets offer archive', async ({ page, werk }) => {
  writeBoard(werk, [
    planned({ number: 1, title: 'In ready' }),
    planned({ number: 2, title: 'In blocked' }),
    planned({ number: 3, title: 'In building' }),
    planned({ number: 4, title: 'In merging' }),
    planned({ number: 5, title: 'In done' }),
    moved(2, 'blocked', 'it waits'),
    moved(3, 'building'),
    moved(4, 'building'),
    moved(4, 'merging'),
    moved(5, 'building'),
    moved(5, 'merging'),
    moved(5, 'done'),
    // An active run: this test's own process stands in for the merge loop.
    { type: 'run.started', payload: { root: ROOT, pid: process.pid } },
  ])
  await openBoard(page)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText(`the run of ${ROOT} is active`)
  for (const [n, col] of [[1, 'ready'], [2, 'blocked'], [3, 'building'], [4, 'merging'], [5, 'done']] as const) await expect(inColumn(page, col, n)).toBeVisible()
  for (const n of [1, 2, 3]) await expect(archiveButton(page, n)).toBeVisible()
  await expect(archiveButton(page, 4)).toHaveCount(0)
  await expect(archiveButton(page, 5)).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  test.setTimeout(90_000)
  const pid = await buildingRun(page, werk)
  await archiveButton(page, 1).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 1)).toHaveCount(0)
  await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false)
  await expect(page.locator('li[data-live="true"]')).toHaveCount(0)
  expect(branches(werk)).toMatch(/werk-build\//)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  test.setTimeout(90_000)
  const pid = await buildingRun(page, werk)
  await archiveButton(page, 1).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  // The build has the time of its board poll to end, if it were going to.
  await page.waitForTimeout(3_000)
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await pulses(page, 1)
  expect(alive(pid)).toBe(true)
})

test('108.4 an archived building ticket is restored onto the board', async ({ page, werk }) => {
  test.setTimeout(90_000)
  await buildingRun(page, werk)
  await archiveButton(page, 1).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 1)).toHaveCount(0)

  werk.cli(['ticket', 'restore', '1'])
  await expect(card(page, 1)).toBeVisible()
  await expect(card(page, 1)).toContainText('Long build')
  expect(branches(werk)).toMatch(/werk-build\//)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  test.setTimeout(90_000)
  const pid = await buildingRun(page, werk)
  await card(page, 1).dragTo(column(page, 'ready'))
  await expect(page.getByRole('alert')).toBeVisible()
  await page.waitForTimeout(2_000)
  await expect(inColumn(page, 'ready', 1)).toHaveCount(0)
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await pulses(page, 1)
  expect(alive(pid)).toBe(true)
})
