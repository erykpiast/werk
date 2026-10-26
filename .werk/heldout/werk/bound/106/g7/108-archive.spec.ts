/** Held-out steps 108.1 to 108.5: archive on the board during an active run. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { alive, appendBoard, column, openBoard, ticket } from './helpers.ts'

const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })

/** An active run of the plan "map": this test's process stands in for the merge loop, as e2e/board.spec.ts does. */
function activeRun(werk: Werk) {
  appendBoard(werk.dir, [{ type: 'run.started', payload: { root: 'map', pid: process.pid } }])
}

/** Ticket 6 (ready) goes to building with a builder session that keeps running. */
async function buildingWithSession(page: Page, werk: Werk) {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: join(werk.dir, '..', 'never') }] } } })
  const build = werk.start(['build', '6', '--cap', '2'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  const { pid } = JSON.parse(readFileSync(join(werk.dir, '.werk', 'sessions', '6.json'), 'utf8')) as { pid: number }
  return { build, pid }
}

const branches = (werk: Werk) => spawnSync('git', ['branch', '--list'], { cwd: werk.dir, encoding: 'utf8' }).stdout

test('108.1 only ready, blocked and building tickets offer archive', async ({ page, werk }) => {
  activeRun(werk)
  await openBoard(page)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('active')
  // Fixture: ready 3, blocked 4, building 2, merging 5, done 1.
  for (const n of [3, 4, 2]) await expect(ticket(page, n).getByRole('button', { name: `Archive ticket ${n}` })).toBeVisible()
  await expect(ticket(page, 5)).toBeVisible()
  await expect(ticket(page, 5).getByRole('button', { name: /archive/i })).toHaveCount(0)
  await expect(ticket(page, 1)).toBeVisible()
  await expect(ticket(page, 1).getByRole('button', { name: /archive/i })).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  activeRun(werk)
  await openBoard(page)
  const { pid } = await buildingWithSession(page, werk)
  expect(alive(pid)).toBe(true)

  await ticket(page, 6).getByRole('button', { name: 'Archive ticket 6' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()

  await expect(ticket(page, 6)).toHaveCount(0)
  await expect.poll(() => alive(pid)).toBe(false)
  await expect(page.locator('li[data-ticket][data-live="true"]')).toHaveCount(0)
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  activeRun(werk)
  await openBoard(page)
  const { pid } = await buildingWithSession(page, werk)

  await ticket(page, 6).getByRole('button', { name: 'Archive ticket 6' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)

  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})

test('108.4 an archived building ticket is restored onto the board', async ({ page, werk }) => {
  activeRun(werk)
  await openBoard(page)
  await buildingWithSession(page, werk)
  await ticket(page, 6).getByRole('button', { name: 'Archive ticket 6' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 6)).toHaveCount(0)

  werk.cli(['ticket', 'restore', '6'])
  await expect(ticket(page, 6)).toBeVisible()
  await expect(ticket(page, 6)).toContainText('Make a failed user path work')
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  activeRun(werk)
  await openBoard(page)
  const { pid } = await buildingWithSession(page, werk)

  await ticket(page, 6).dragTo(column(page, 'ready'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toHaveCount(0)
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})
