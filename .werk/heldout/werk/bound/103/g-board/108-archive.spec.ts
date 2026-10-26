/** Held-out steps 108.1 - 108.5: archive on the board, and a running build. */
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { alive, appendBoard, branches, column, inColumn, moved, openBoard, said, sessionPid, ticket } from './helpers.ts'

/** Ticket 6 in building with a builder session that runs until the test ends. */
async function building(page: Page, werk: Werk) {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: join(werk.dir, '..', 'never') }] } } })
  const build = werk.start(['build', '6', '--cap', '2'])
  await openBoard(page, werk)
  await expect(inColumn(page, 'building', 6)).toBeVisible({ timeout: 15_000 })
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  await expect.poll(() => sessionPid(werk, 6)).toBeDefined()
  return { build, pid: sessionPid(werk, 6)! }
}

test('108.1 only ready, blocked and building tickets offer archive', async ({ page, werk }) => {
  await openBoard(page, werk)
  // ready 3, blocked 4, building 2, merging 5, done 1
  for (const n of [3, 4, 2]) await expect(ticket(page, n).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(ticket(page, 5).getByRole('button', { name: /archive/i })).toHaveCount(0)
  await expect(ticket(page, 1).getByRole('button', { name: /archive/i })).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  const { pid } = await building(page, werk)
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 6)).toHaveCount(0)
  await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false)
  await expect(page.locator('li[data-live]')).toHaveCount(0)
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  const { pid } = await building(page, werk)
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(2_000)
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})

test('108.4 an archived building ticket is restored onto the board', async ({ page, werk }) => {
  await building(page, werk)
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 6)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '6'])
  await expect(ticket(page, 6)).toBeVisible()
  await expect(ticket(page, 6)).toContainText('Make a failed user path work')
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  const { pid } = await building(page, werk)
  await ticket(page, 6).dragTo(column(page, 'ready'))
  await page.waitForTimeout(1_500)
  await expect(inColumn(page, 'ready', 6)).toHaveCount(0)
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})
void appendBoard
void moved
