/** Held-out steps 88.1 and 89.1 to 89.5: the person's start, order, trigger, drag and archive controls. */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { boardEvents, gated, movesOf, runProject, runScript, ticketOf, writes } from './lib.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = (page: Page) => page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
const numbersIn = (page: Page, name: string) =>
  column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))

/** Ends the merge loops this test started, and their builders: the test's own cleanup. */
function endRuns(werk: Werk) {
  for (const e of boardEvents(werk.dir))
    if (e.type === 'run.started' && e.payload.pid !== process.pid) {
      for (const target of [-e.payload.pid, e.payload.pid])
        try {
          process.kill(target, 'SIGKILL')
        } catch {}
    }
}

test.afterEach(({ werk }) => endRuns(werk))

test('88.1 nothing builds before the person starts the run', async ({ page, werk }) => {
  const gate = join(werk.dir, '..', 'gate')
  runProject(werk.dir, [1, 2, 3].map((n) => ticketOf(n)))
  werk.scriptAgent(runScript([gated(gate, 'a.txt'), gated(gate, 'b.txt'), gated(gate, 'c.txt')], [1, 2, 3]))
  await toBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket]')).toHaveCount(3)
  // The person waits on the board.
  await page.waitForTimeout(3000)
  expect(await numbersIn(page, 'ready')).toEqual([1, 2, 3])
  await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)
  expect(boardEvents(werk.dir).some((e) => e.type === 'ticket.moved')).toBe(false)
  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of root' }).click()
  for (const n of [1, 2, 3]) await expect(column(page, 'building').locator(`li[data-ticket="${n}"]`)).toBeVisible({ timeout: 15_000 })
})

test('89.1 nothing builds before the start, and the start builds in the order the person chose', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const gate = join(werk.dir, '..', 'gate')
  runProject(werk.dir, [ticketOf(1, { title: 'Alpha', touches: ['decision log'] }), ticketOf(2, { title: 'Beta', touches: ['decision log'] })])
  werk.scriptAgent(runScript([gated(gate, 'beta.txt'), writes('alpha.txt')], [1, 2]))
  await toBoard(page)
  await expect.poll(() => numbersIn(page, 'ready')).toEqual([1, 2])
  await page.waitForTimeout(3000)
  expect(await numbersIn(page, 'ready')).toEqual([1, 2])
  await ticket(page, 2).dragTo(ticket(page, 1))
  await expect.poll(() => numbersIn(page, 'ready')).toEqual([2, 1])
  await page.reload()
  await expect(column(page, 'ready').locator('li[data-ticket]')).toHaveCount(2)
  expect(await numbersIn(page, 'ready')).toEqual([2, 1])
  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of root' }).click()
  await expect(column(page, 'building').locator('li[data-ticket="2"]')).toBeVisible({ timeout: 15_000 })
  await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  await expect(column(page, 'ready').locator('li[data-ticket="1"]')).toBeVisible()
  writeFileSync(gate, '')
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toBeVisible({ timeout: 60_000 })
  expect(movesOf(werk.dir, 2)).toEqual(['building', 'merging', 'done'])
  const events = boardEvents(werk.dir)
  const at = (n: number, to: string) => events.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)
  expect(at(1, 'building')).toBeGreaterThan(at(2, 'done'))
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  await toBoard(page)
  // Fixture: Gamma is ticket 6 (ready), Delta is ticket 4 (blocked), Epsilon is ticket 2 (building).
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(column(page, 'blocked').locator('li[data-ticket="4"]')).toBeVisible()
  await expect(column(page, 'building').locator('li[data-ticket="2"]')).toBeVisible()
  await expect(ticket(page, 6).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(ticket(page, 4).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect.soft(ticket(page, 2).getByRole('button', { name: /archive/i }), 'Epsilon (building) shows no archive action').toHaveCount(0)
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 6)).toHaveCount(0)
  await page.reload()
  await expect(column(page, 'ready')).toBeVisible()
  await expect(ticket(page, 6)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '6'])
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
})

test('89.3 the trigger icon starts one ready ticket early, and it goes through the merge queue', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const gate = join(werk.dir, '..', 'gate')
  runProject(werk.dir, [ticketOf(1, { title: 'Busy', touches: ['decision log'] }), ticketOf(2, { title: 'Zeta', touches: ['decision log'] })])
  werk.scriptAgent(runScript([gated(gate, 'busy.txt'), writes('zeta.txt')], [1, 2]))
  await toBoard(page)
  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of root' }).click()
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  await expect(column(page, 'ready').locator('li[data-ticket="2"]')).toBeVisible()
  await ticket(page, 2).getByRole('button', { name: /trigger/i }).click()
  await expect(column(page, 'building').locator('li[data-ticket="2"]')).toBeVisible()
  writeFileSync(gate, '')
  await expect(column(page, 'done').locator('li[data-ticket="2"]')).toBeVisible({ timeout: 60_000 })
  const moves = movesOf(werk.dir, 2)
  expect(moves.indexOf('merging')).toBeGreaterThanOrEqual(0)
  expect(moves.indexOf('done')).toBeGreaterThan(moves.indexOf('merging'))
})

test('89.4 a drag into building starts a ticket, and a drag back into ready stops it', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const gate = join(werk.dir, '..', 'gate')
  runProject(werk.dir, [ticketOf(1, { title: 'Busy', touches: ['decision log'] }), ticketOf(2, { title: 'Eta', touches: ['decision log'] })])
  werk.scriptAgent(runScript([gated(gate, 'busy.txt'), gated(join(werk.dir, '..', 'never'), 'eta.txt')], [1, 2]))
  await toBoard(page)
  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of root' }).click()
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  await expect(column(page, 'ready').locator('li[data-ticket="2"]')).toBeVisible()
  await ticket(page, 2).dragTo(column(page, 'building'))
  await expect(column(page, 'building').locator('li[data-ticket="2"]')).toBeVisible()
  // The ticket that held the shared module finishes, so Eta's build can run.
  writeFileSync(gate, '')
  await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 60_000 })
  await ticket(page, 2).dragTo(column(page, 'ready'))
  await expect.soft(column(page, 'ready').locator('li[data-ticket="2"]'), 'Eta shows in ready after the drag back').toBeVisible()
  await expect.soft(ticket(page, 2), 'the build of Eta stops').not.toHaveAttribute('data-live')
  expect.soft(movesOf(werk.dir, 2)).not.toContain('merging')
  await page.reload()
  await expect(column(page, 'ready')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="2"]'), 'Eta in ready after a reload').toBeVisible()
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  // An active run of the fixture's plan "map": this test's process stands in for the merge loop.
  appendFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    JSON.stringify({ seq: 18, at: new Date().toISOString(), actor: 'agent', type: 'run.started', payload: { root: 'map', pid: process.pid } }) + '\n',
  )
  await toBoard(page)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('active')
  // Theta is ticket 6 (ready), Iota is ticket 4 (blocked), Kappa is ticket 2 (building).
  await ticket(page, 6).dragTo(column(page, 'merging'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
  await ticket(page, 2).dragTo(column(page, 'done'))
  await expect(page.getByRole('alert')).toContainText('done')
  await expect(column(page, 'building').locator('li[data-ticket="2"]')).toBeVisible()
  await ticket(page, 4).dragTo(column(page, 'building'))
  await expect(column(page, 'blocked').locator('li[data-ticket="4"]')).toBeVisible()
  await expect(column(page, 'building').locator('li[data-ticket="4"]')).toHaveCount(0)
  expect(boardEvents(werk.dir).some((e) => e.type === 'ticket.triggered' || (e.type === 'ticket.moved' && e.seq > 18))).toBe(false)
  for (const n of [6, 4, 2]) {
    await ticket(page, n).getByRole('link').click()
    const views = page.locator('.views-pane')
    await expect(views.getByRole('textbox')).toHaveCount(0)
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0)
  }
})
