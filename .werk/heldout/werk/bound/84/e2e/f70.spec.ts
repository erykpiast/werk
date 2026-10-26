/** Feature 70: ghosts in the map, and the ✓ that accepts one. */
import { accepted, linked, proposed } from '../../src/test/map-events.ts'
import { expect, open, test, type Proj } from './harness.ts'
import type { Locator } from '@playwright/test'

const li = (id: string) => `li[data-card-id="${id}"]`
const GREY = 'rgb(138, 138, 138)'
const expectGhost = async (tile: Locator) => {
  await expect(tile).toHaveCSS('border-top-style', 'dashed')
  await expect(tile).toHaveCSS('color', GREY)
}
const expectReal = async (tile: Locator) => {
  await expect(tile).not.toHaveCSS('border-top-style', 'dashed')
  await expect(tile).not.toHaveCSS('color', GREY)
}
const payments = (proj: Proj) => proj.seed(proposed('payments', { title: 'Payments' }), accepted('payments'))

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, proj }) => {
  payments(proj)
  proj.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await open(page, proj)
  const refunds = page.locator(`${li('payments')} > ul > ${li('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expectGhost(refunds)
  await expectReal(page.locator(`${li('payments')} > a`))
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, proj }) => {
  payments(proj)
  proj.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await open(page, proj)
  await expectGhost(page.locator(`${li('payments')} > ul > ${li('refunds')} > a`))
  await page.locator(`${li('refunds')} > a`).click()
  const before = proj.logLines().length
  await page.getByRole('button', { name: /Accept #refunds/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0)
  const lines = proj.logLines()
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const tile = page.locator(`${li('payments')} > ul > ${li('refunds')} > a`)
  await expect(tile).toContainText('Refunds')
  await expectReal(tile)
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, proj }) => {
  payments(proj)
  proj.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  proj.cli(['add', 'partial-refunds', '--title', 'Partial refunds', '--parent', 'refunds'])
  await open(page, proj, '#partial-refunds')
  await page.getByRole('button', { name: /Accept #partial-refunds/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const partial = page.locator(`${li('payments')} > ul > ${li('refunds')} > ul > ${li('partial-refunds')} > a`)
  const refunds = page.locator(`${li('payments')} > ul > ${li('refunds')} > a`)
  await expect(partial).toContainText('Partial refunds')
  await expectReal(partial)
  await expectReal(refunds)
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, proj }) => {
  payments(proj)
  proj.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  proj.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  proj.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Refund by hand', '--why-not', 'Too slow'])
  proj.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  proj.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'The refund policy'])
  proj.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await open(page, proj)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${li('refunds')} > a`).click()
  await page.getByRole('button', { name: /Accept #refunds/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await expectReal(page.locator(`${li('refunds')} > a`))
  await expect(page.locator(li('refunds-opt'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(li('refunds-src'))).toHaveAttribute('data-proposed', 'false')
  await expectGhost(page.locator(`${li('payments')} > ul > ${li('chargebacks')} > a`))
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, proj, context }) => {
  payments(proj)
  proj.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  const url = await open(page, proj)
  const second = await context.newPage()
  await second.goto(url)
  await expect(page.locator(li('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(li('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${li('refunds')} > a`).click()
  await page.getByRole('button', { name: /Accept #refunds/ }).click()
  await expect(second.locator(li('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expectReal(second.locator(`${li('refunds')} > a`))
})
