/**
 * Held-out steps 108.x: archive on the board. The fixture board holds ready 3 and 6, blocked 4,
 * building 2, merging 5 and done 1. Ticket 6 belongs to the plan run "map".
 */
import { join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'
import type { Werk } from '../e2e/harness.ts'
import type { Page } from '@playwright/test'
import { activeRun, alive, branches, card, column, inColumn, openBoard, said, sessionPid } from './h89-90-lib.ts'

/** An active run of "map" and a running builder session for ticket 6, which pulses in building. */
async function buildingTicket(page: Page, werk: Werk) {
  activeRun(werk, 'map')
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Building.'), { waitFor: join(werk.dir, '..', 'never') }] } } })
  const build = werk.start(['build', '6', '--cap', '2'])
  await openBoard(page)
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await expect(card(page, 6)).toHaveAttribute('data-live', 'true')
  return { build, pid: sessionPid(werk, 6) }
}

test('108.1 only ready, blocked, and building tickets offer archive', async ({ page, werk }) => {
  // Given an active run with a ticket in ready, a ticket in blocked, a ticket in building, a ticket in merging, and a ticket in done
  activeRun(werk, 'map')
  // When the person opens the board
  await openBoard(page)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('the run of map is active')
  // Then the ready ticket, the blocked ticket, and the building ticket each show the archive action
  for (const [col, n] of [['ready', 6], ['blocked', 4], ['building', 2]] as const) {
    await expect(inColumn(page, col, n).getByRole('button', { name: `Archive ticket ${n}` })).toBeVisible()
  }
  // And the merging ticket does not show the archive action
  await expect(inColumn(page, 'merging', 5)).toBeVisible()
  await expect(card(page, 5).getByRole('button', { name: /^Archive/ })).toHaveCount(0)
  // But the done ticket does not show the archive action either
  await expect(inColumn(page, 'done', 1)).toBeVisible()
  await expect(card(page, 1).getByRole('button', { name: /^Archive/ })).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  const { pid } = await buildingTicket(page, werk)
  expect(alive(pid)).toBe(true)
  // When the person presses the archive action on the building ticket
  await card(page, 6).getByRole('button', { name: 'Archive ticket 6' }).click()
  // Then a confirmation appears that says the ticket can be restored
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/restore/i)
  // When the person confirms the archive
  await dialog.getByRole('button', { name: 'Archive' }).click()
  // Then the ticket leaves the board
  await expect(card(page, 6)).toHaveCount(0)
  // And the builder session for that ticket is no longer running
  await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false)
  // And no ticket on the board pulses for that build
  await expect(page.locator('li[data-ticket][data-live="true"]')).toHaveCount(0)
  // And the ticket's branch still exists in the repository
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  const { pid } = await buildingTicket(page, werk)
  // When the person presses the archive action on the building ticket
  await card(page, 6).getByRole('button', { name: 'Archive ticket 6' }).click()
  // And the person cancels the confirmation
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  // Then the ticket stays in building
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  // And the ticket still pulses
  await expect(card(page, 6)).toHaveAttribute('data-live', 'true')
  // And the builder session for that ticket is still running
  expect(alive(pid)).toBe(true)
})

test('108.4 an archived building ticket is restored onto the board', async ({ page, werk }) => {
  await buildingTicket(page, werk)
  // And the person archives the building ticket and confirms
  await card(page, 6).getByRole('button', { name: 'Archive ticket 6' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 6)).toHaveCount(0)
  // When an agent restores the archived ticket
  werk.cli(['ticket', 'restore', '6'])
  // Then the ticket appears on the board again with its title
  await expect(card(page, 6)).toBeVisible()
  await expect(card(page, 6).getByRole('link')).toHaveText('Make a failed user path work')
  // And the ticket's branch still exists in the repository
  expect(branches(werk)).toMatch(/werk-build\/werk-06-/)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  const { pid } = await buildingTicket(page, werk)
  // When the person drags the building ticket into the ready column
  await card(page, 6).dragTo(column(page, 'ready'))
  await expect(page.getByRole('alert')).toBeVisible()
  // Then the ticket does not appear in ready
  await expect(inColumn(page, 'ready', 6)).toHaveCount(0)
  // And the ticket stays in building
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  // And the ticket still pulses
  await expect(card(page, 6)).toHaveAttribute('data-live', 'true')
  // And the builder session for that ticket is still running
  expect(alive(pid)).toBe(true)
})
