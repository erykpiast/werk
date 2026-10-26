import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const GREY = 'rgb(138, 138, 138)'

const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

/** A real card "Payments" under the fixture's root, and a ghost "Refunds" under it. */
function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}

async function expectGhost(page: Page, id: string) {
  const tile = page.locator(`${card(id)} > a`)
  await expect(tile).toHaveCSS('border-top-style', 'dashed')
  await expect(tile).toHaveCSS('color', GREY)
}
async function expectReal(page: Page, id: string) {
  const tile = page.locator(`${card(id)} > a`)
  await expect(tile).not.toHaveCSS('border-top-style', 'dashed')
  await expect(tile).not.toHaveCSS('color', GREY)
  await expect(page.locator(card(id))).toHaveAttribute('data-proposed', 'false')
}

// 70.1
// Scenario: A proposed card shows as a ghost under its proposed parent
// Given the map shows a real card "Payments"
// And an agent proposes a new card "Refunds" that refines "Payments"
// When the person opens the map
// Then "Refunds" shows under "Payments" in the refines tree
// And "Refunds" is drawn grey and dashed
// But "Payments" is drawn as a normal real card, not grey and not dashed
test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expectGhost(page, 'refunds')
  await expect(page.locator(`${card('payments')} > a`)).toContainText('Payments')
  await expectReal(page, 'payments')
})

// 70.2
// Scenario: The person accepts one ghost with the ✓ button and it becomes real
// Given the map shows a ghost card "Refunds" under the real card "Payments"
// When the person opens the card view of "Refunds"
// And the person presses the ✓ button
// Then the log has one new accept event for "Refunds" with the person as the actor
// And the map redraws "Refunds" as a real card under "Payments"
// And the card view of "Refunds" no longer shows a ✓ button
test('70.2 the ✓ button accepts one ghost and it becomes real', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  await expectGhost(page, 'refunds')
  await page.locator(`${card('refunds')} > a`).click()
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'refunds')
  const before = logLines(werk).length
  await page.locator('button', { hasText: '✓' }).click()

  await expect(detail).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.locator('button', { hasText: '✓' })).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)

  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toBeVisible()
  await expectReal(page, 'refunds')
})

// 70.3
// Scenario: Accepting a ghost child under a ghost parent makes both real
// Given the map shows a real card "Payments"
// And a ghost card "Refunds" under "Payments"
// And a ghost card "Partial refunds" under "Refunds"
// When the person opens the card view of "Partial refunds" and presses ✓
// Then the map redraws "Partial refunds" as a real card
// And the map redraws "Refunds" as a real card
// And "Partial refunds" still shows under "Refunds", and "Refunds" still shows under "Payments"
test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'partial-refunds', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(werk.url)
  await expectGhost(page, 'refunds')
  await expectGhost(page, 'partial-refunds')

  await page.locator(`${card('partial-refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'partial-refunds')
  await page.locator('button', { hasText: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')

  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial-refunds')}`)).toBeVisible()
  await expectReal(page, 'partial-refunds')
  await expectReal(page, 'refunds')
})

// 70.4
// Scenario: An accept takes only the accepted card's branch, not other ghosts
// Given the map shows a real card "Payments"
// And two ghost cards "Refunds" and "Chargebacks" under "Payments"
// And "Refunds" has a proposed option and a proposed source
// When the person presses ✓ on "Refunds"
// Then "Refunds" redraws as a real card, with its option and its source as real
// But "Chargebacks" still shows grey and dashed
// And the map shows no control that accepts "Refunds" and "Chargebacks" together
test('70.4 an accept takes only the accepted card branch', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Refund by bank transfer', '--why-not', 'Slow'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'The refund policy page'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  for (const id of ['refunds', 'chargebacks', 'refunds-opt', 'refunds-src']) await expectGhost(page, id)
  // The map view has no accept control at all.
  await expect(page.getByRole('button')).toHaveCount(0)

  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.locator('button', { hasText: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')

  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await expectReal(page, 'refunds')
  await expectReal(page, 'refunds-opt')
  await expectReal(page, 'refunds-src')
  await expectGhost(page, 'chargebacks')
  await expect(page.locator(card('chargebacks'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.getByRole('button')).toHaveCount(0)
})

// 70.5
// Scenario: A second view sees the accept because it reads the same log
// Given the person has the map open in two browser windows
// And both windows show a ghost card "Refunds"
// When the person presses ✓ on "Refunds" in the first window
// Then the second window redraws "Refunds" as a real card without a manual edit
test('70.5 a second window sees the accept', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expectGhost(page, 'refunds')
  await expectGhost(second, 'refunds')

  await page.locator(`${card('refunds')} > a`).click()
  await page.locator('button', { hasText: '✓' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')

  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  await expectReal(second, 'refunds')
  await second.close()
})
