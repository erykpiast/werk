import { acc, expect, prop, seedLog, test } from './harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const GREY = 'rgb(138, 138, 138)'
const payments = [prop('payments', 'Payments'), acc('payments')]

test.describe('70.1', () => {
  test.use({ seed: seedLog(payments) })
  test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
    await expect(page.locator(card('payments'))).toBeVisible()
    werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
    await page.goto(werk.url)
    const ghost = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
    await expect(ghost).toContainText('Refunds')
    await expect(ghost).toHaveCSS('border-top-style', 'dashed')
    await expect(ghost).toHaveCSS('color', GREY)
    const real = page.locator(`${card('payments')} > a`)
    await expect(real).not.toHaveCSS('border-top-style', 'dashed')
    await expect(real).not.toHaveCSS('color', GREY)
  })
})

test.describe('70.2', () => {
  test.use({ seed: seedLog([...payments, prop('refunds', 'Refunds', { parent: 'payments' })]) })
  test('70.2 the ✓ button accepts one ghost', async ({ page, werk }) => {
    await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
    await page.locator(`${card('refunds')} > a`).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
    const before = werk.log().length
    await page.getByRole('button', { name: /Accept/ }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    const lines = werk.log()
    expect(lines.length).toBe(before + 1)
    expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
    await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0)
    await expect(page.locator('button', { hasText: '✓' })).toHaveCount(0)
    await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
    const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
    await expect(tile).toHaveAttribute('data-proposed', 'false')
    await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  })
})

test.describe('70.3', () => {
  test.use({
    seed: seedLog([...payments, prop('refunds', 'Refunds', { parent: 'payments' }), prop('partial', 'Partial refunds', { parent: 'refunds' })]),
  })
  test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page }) => {
    await page.locator(`${card('partial')} > a`).click()
    await page.getByRole('button', { name: /Accept/ }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
    const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
    const partial = refunds.locator(`> ul > ${card('partial')}`)
    await expect(partial).toHaveAttribute('data-proposed', 'false')
    await expect(refunds).toHaveAttribute('data-proposed', 'false')
    await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
    await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  })
})

test.describe('70.4', () => {
  test.use({
    seed: seedLog([
      ...payments,
      prop('refunds', 'Refunds', { parent: 'payments' }),
      prop('chargebacks', 'Chargebacks', { parent: 'payments' }),
      prop('refunds-opt', 'Refund by voucher', { kind: 'option', whyNot: 'Users want cash' }),
      { type: 'edge.linked', payload: { from: 'refunds-opt', to: 'refunds', type: 'alternative_to' } },
      prop('refunds-src', 'Refund policy notes', { kind: 'source' }),
      { type: 'edge.linked', payload: { from: 'refunds', to: 'refunds-src', type: 'supported_by' } },
    ]),
  })
  test('70.4 an accept takes only the accepted branch', async ({ page }) => {
    await expect(page.getByRole('button')).toHaveCount(0)
    await page.locator(`${card('refunds')} > a`).click()
    await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(1)
    await page.getByRole('button', { name: /Accept/ }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
    await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
    await expect(page.locator(card('refunds-opt'))).toHaveAttribute('data-proposed', 'false')
    await expect(page.locator(card('refunds-src'))).toHaveAttribute('data-proposed', 'false')
    const cb = page.locator(`${card('chargebacks')} > a`)
    await expect(cb).toHaveCSS('border-top-style', 'dashed')
    await expect(cb).toHaveCSS('color', GREY)
    await expect(page.getByRole('button')).toHaveCount(0)
  })
})

test.describe('70.5', () => {
  test.use({ seed: seedLog([...payments, prop('refunds', 'Refunds', { parent: 'payments' })]) })
  test('70.5 a second view sees the accept', async ({ page, werk }) => {
    const second = await page.context().newPage()
    await second.goto(werk.url)
    await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
    await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
    await page.locator(`${card('refunds')} > a`).click()
    await page.getByRole('button', { name: /Accept/ }).click()
    await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
    await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  })
})
