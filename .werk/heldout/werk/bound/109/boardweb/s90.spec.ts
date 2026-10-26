import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/harness.ts'
import { card, column, gate, inColumn, killAll, noPulse, open, openBoard, planned, prepareRepo, pulses, result, ROOT, said, scriptRun, writeBoard } from './helpers.ts'

test.afterEach(async ({ werk }) => {
  killAll(werk)
  await new Promise((r) => setTimeout(r, 1_000))
})

const start = (page: Page) => page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
const drawer = (page: Page) => page.getByRole('region', { name: 'drawer' })
const log = (page: Page) => drawer(page).getByRole('region', { name: 'agent log' })

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  test.setTimeout(90_000)
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'Pulse me' })])
  scriptRun(werk, { steps: [said('Working.'), { sleep: 4_000 }, { edit: { path: 'p.txt', content: 'p\n' } }, result] })
  await openBoard(page)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await start(page)
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  await pulses(page, 1)
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  await noPulse(page, 1)
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  test.setTimeout(120_000)
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'Log me' })])
  const steps = Array.from({ length: 20 }, (_, i) => [said(`Event ${i + 1}.`), { sleep: 1_000 }]).flat()
  scriptRun(werk, { steps: [...steps, { waitFor: gate(werk, 'end') }, result] })
  await openBoard(page)
  await start(page)
  await card(page, 1).getByRole('link').first().click()
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  await expect(drawer(page)).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer(page).boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  await expect(log(page)).toBeVisible()
  const slice = drawer(page).getByRole('article', { name: 'slice' })
  expect((await log(page).boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  await expect(log(page).getByRole('listitem').first()).toHaveText(/Event 1\.$/)
  const h1 = (await log(page).boundingBox())!.height
  await expect(log(page).getByRole('listitem').nth(1)).toHaveText(/Event 2\.$/)
  // More events come; the preview keeps its height while its content scrolls.
  await expect(log(page).getByRole('listitem').filter({ hasText: /Event 18\.$/ })).toHaveCount(1, { timeout: 30_000 })
  const h2 = (await log(page).boundingBox())!.height
  expect(Math.abs(h2 - h1)).toBeLessThan(2)
  const lines = log(page).locator('ol')
  const { sh, ch, top } = await lines.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop }))
  expect(sh).toBeGreaterThan(ch)
  expect(top).toBeGreaterThan(0)
  open(werk, 'end')
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // The check is slow on the merge queue's detached tree, so merging lasts long enough to see.
  prepareRepo(werk, 'check:\n\t@if ! git symbolic-ref -q HEAD >/dev/null; then sleep 15; fi\n')
  writeBoard(werk, [planned({ number: 1, title: 'Merge me' })])
  scriptRun(werk, { steps: [said('Working.'), { edit: { path: 'm.txt', content: 'm\n' } }, { waitFor: gate(werk, 'exit') }, result] })
  await openBoard(page)
  await start(page)
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await card(page, 1).getByRole('link').first().click()
  await expect(log(page).getByRole('listitem').first()).toHaveText(/Working\.$/)

  open(werk, 'exit')
  await expect(inColumn(page, 'merging', 1)).toBeVisible({ timeout: 20_000 })
  await noPulse(page, 1)
  await expect(drawer(page)).toHaveAttribute('data-ticket', '1')
  await expect(drawer(page).getByRole('article', { name: 'slice' })).toContainText('Merge me')
  await expect(drawer(page).getByRole('complementary', { name: 'metadata' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  await expect(inColumn(page, 'merging', 1)).toBeVisible()
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // The check is slow and is red until a pass writes ok.txt.
  prepareRepo(werk, 'check:\n\t@sleep 8; test -f ok.txt\n')
  writeBoard(werk, [planned({ number: 1, title: 'Retry me' })])
  scriptRun(werk, [
    { steps: [said('First try.'), { sleep: 3_000 }], exit: 1 },
    { steps: [said('Second try.'), { edit: { path: 'ok.txt', content: 'ok\n' } }, { waitFor: gate(werk, 'second') }, result] },
  ])
  await openBoard(page)
  await start(page)
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  await pulses(page, 1)
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 10_000 })
  await noPulse(page, 1)
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  expect(werk.agentRuns().filter((r) => r.role === 'builder')).toHaveLength(1)
  open(werk, 'second')
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  test.setTimeout(90_000)
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'Stop me' })])
  scriptRun(werk, { steps: [said('Working.'), { waitFor: gate(werk, 'never') }, result] })
  await openBoard(page)
  await start(page)
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  await pulses(page, 1)

  // The one hand stop of a build the board offers to drag is a drag back to ready.
  await card(page, 1).dragTo(column(page, 'ready'))
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 10_000 })
  await expect(inColumn(page, 'ready', 1)).toBeVisible({ timeout: 10_000 })
  await card(page, 1).getByRole('link').first().click()
  await expect(drawer(page)).toHaveAttribute('data-ticket', '1')
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})
