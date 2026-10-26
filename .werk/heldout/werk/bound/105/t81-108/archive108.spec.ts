/** Held-out steps 108.1 to 108.5: archive on the board, and a building ticket with a running builder. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { alive } from './lib.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })

test.beforeEach(async ({ page }) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
})

/** Ticket 6 of the fixture goes to building with a builder session that runs until the test ends. */
async function building(page: Page, werk: Werk) {
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: join(werk.dir, '..', 'never') }] } } })
  const build = werk.start(['build', '6', '--cap', '2'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  const { pid } = JSON.parse(readFileSync(join(werk.dir, '.werk', 'sessions', '6.json'), 'utf8')) as { pid: number }
  expect(alive(pid)).toBe(true)
  return { build, pid }
}
const branches = (werk: Werk) => spawnSync('git', ['branch', '--list', 'werk-build/*'], { cwd: werk.dir, encoding: 'utf8' }).stdout.trim()

test('108.1 only ready, blocked, and building tickets offer archive', async ({ page }) => {
  // Fixture: 6 ready, 4 blocked, 2 building, 5 merging, 1 done.
  for (const [n, col] of [[6, 'ready'], [4, 'blocked'], [2, 'building'], [5, 'merging'], [1, 'done']] as const)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toBeVisible()
  for (const n of [6, 4, 2]) await expect(ticket(page, n).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(ticket(page, 5).getByRole('button', { name: /archive/i })).toHaveCount(0)
  await expect(ticket(page, 1).getByRole('button', { name: /archive/i })).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  const { build, pid } = await building(page, werk)
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 6)).toHaveCount(0)
  await build.exited
  expect(alive(pid)).toBe(false)
  await expect(page.locator('li[data-ticket][data-live]')).toHaveCount(0)
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  const { pid } = await building(page, werk)
  await ticket(page, 6).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
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
  await expect(ticket(page, 6).getByRole('link')).toHaveText('Make a failed user path work')
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  const { pid } = await building(page, werk)
  await ticket(page, 6).dragTo(column(page, 'ready'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toHaveCount(0)
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})
