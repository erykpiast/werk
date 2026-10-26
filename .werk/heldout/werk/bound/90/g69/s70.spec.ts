/** Held-out steps 70.1–70.5: ghosts in the map and the ✓ button. */
import { expect, test } from '../../e2e/harness.ts'
import type { Werk } from '../../e2e/harness.ts'
import { card, logLines, realCard, seed } from './helpers.ts'

const GREY = 'rgb(138, 138, 138)'

function paymentsWithRefunds(werk: Werk) {
  seed(werk, realCard('payments', 'Payments'))
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  const ghost = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('color', GREY)
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  const real = map.locator(`> ${card('payments')} > a`)
  await expect(real).not.toHaveCSS('color', GREY)
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  const before = logLines(werk).length
  // When the person opens the card view of "Refunds"
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  // And presses ✓
  await page.getByRole('button', { name: /Accept #refunds/ }).click()
  // Then the card view no longer shows a ✓ button
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0)
  // And the log has one new accept event with the person as actor
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  // And the map redraws "Refunds" as a real card under "Payments"
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial`)
  await page.getByRole('button', { name: /Accept #partial/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const map = page.getByRole('list', { name: 'map' })
  const refunds = map.locator(`> ${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Refund by store credit', '--why-not', 'People want money back'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  // And the map shows no control that accepts both together
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: /Accept #refunds/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  const charge = page.locator(`${card('chargebacks')} > a`)
  await expect(charge).toHaveCSS('border-top-style', 'dashed')
  await expect(charge).toHaveCSS('color', GREY)
  // its option and source are real
  await page.goto(`${werk.url}#refunds-opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk, context }) => {
  paymentsWithRefunds(werk)
  await page.goto(`${werk.url}#refunds`)
  const second = await context.newPage()
  await second.goto(werk.url)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: /Accept #refunds/ }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})
