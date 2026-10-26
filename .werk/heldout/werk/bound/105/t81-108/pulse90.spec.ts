/** Held-out steps 90.1 to 90.5: the pulse of a building ticket and the drawer's log preview. */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/harness.ts'
import { gated, makefile, runProject, runScript, ticketOf } from './lib.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const result = { event: { type: 'result', subtype: 'success' } }
const toBoard = (page: Page) => page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working.'), { sleep: 3000 }, result] } } })
  await toBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  const build = werk.start(['build', '6', '--cap', '1'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  await build.exited
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live')
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  test.setTimeout(60_000)
  const steps = Array.from({ length: 20 }, (_, i) => [said(`Event number ${i + 1}.`), { sleep: 1000 }]).flat()
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [...steps, result] } } })
  await toBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  werk.start(['build', '6', '--cap', '1'])
  await column(page, 'building').locator('li[data-ticket="6"]').getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  const log = drawer.getByRole('region', { name: 'agent log' })
  const slice = drawer.getByRole('article', { name: 'slice' })
  await expect(log).toContainText('Event number 1.')
  expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  const firstHeight = (await log.boundingBox())!.height
  await expect(log).toContainText('Event number 2.')
  const lines = log.locator('ol')
  await expect(log).toContainText('Event number 20.', { timeout: 30_000 })
  expect((await log.boundingBox())!.height).toBe(firstHeight)
  const { scroll, client } = await lines.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(scroll).toBeGreaterThan(client)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  test.setTimeout(90_000)
  const gate = join(werk.dir, '..', 'pass-exit')
  // The merge queue's check waits 15 s, so the ticket sits in merging that long.
  runProject(werk.dir, [ticketOf(1)], makefile(15))
  werk.scriptAgent(runScript([gated(gate, 't1.txt')], [1]))
  werk.start(['run', 'root'])
  await toBoard(page)
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  await column(page, 'building').locator('li[data-ticket="1"]').getByRole('link').click()
  await expect(page.getByRole('region', { name: 'agent log' })).toBeVisible()
  writeFileSync(gate, '')
  await expect(column(page, 'merging').locator('li[data-ticket="1"]')).toBeVisible({ timeout: 15_000 })
  await expect(ticket(page, 1)).not.toHaveAttribute('data-live')
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
  await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
  await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  test.setTimeout(60_000)
  // The ticket's checks take 6 s and fail, so the first pass fails and the build waits before its next attempt.
  writeFileSync(join(werk.dir, 'Makefile'), 'test:\n\t@sleep 6; exit 1\ne2e:\n\t@sleep 6; exit 1\n')
  spawnSync('git', ['add', 'Makefile'], { cwd: werk.dir })
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'checks'], { cwd: werk.dir })
  werk.scriptAgent({
    steps: [],
    roles: { builder: [{ steps: [said('First pass.'), { sleep: 1500 }, result] }, { steps: [said('Second pass.'), { waitFor: join(werk.dir, '..', 'never') }] }] },
  })
  await toBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  werk.start(['build', '6', '--cap', '2'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toHaveAttribute('data-live', 'true')
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live')
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: join(werk.dir, '..', 'never') }] } } })
  await toBoard(page)
  werk.start(['build', '6', '--cap', '2'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toHaveAttribute('data-live', 'true')
  // The board's one manual stop of a build: archive, after the confirmation.
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(page.locator('li[data-ticket="6"][data-live]')).toHaveCount(0)
  await expect(page.locator('li[data-ticket][data-live]')).toHaveCount(0)
  // The ticket comes back on the board the way the product offers: a restore.
  werk.cli(['ticket', 'restore', '6'])
  await expect.soft(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  await ticket(page, 6).getByRole('link').click()
  await expect(page.getByRole('region', { name: 'drawer' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})
