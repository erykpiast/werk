import { card, expect, ghost, real, test } from './harness.ts'

const GREY = 'rgb(138, 138, 138)'
const base = [...real('payments', 'Payments')]

test.describe('70.1', () => {
  test.use({ log: { events: [...base, ...ghost('refunds', 'Refunds', { parent: 'payments' })] } })
  test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
    await page.goto(werk.url)
    const map = page.getByRole('list', { name: 'map' })
    const g = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
    await expect(g).toContainText('Refunds')
    await expect(g).toHaveCSS('color', GREY)
    await expect(g).toHaveCSS('border-top-style', 'dashed')
    const r = map.locator(`> ${card('payments')} > a`)
    await expect(r).not.toHaveCSS('color', GREY)
    await expect(r).not.toHaveCSS('border-top-style', 'dashed')
  })
})

test.describe('70.2', () => {
  test.use({ log: { events: [...base, ...ghost('refunds', 'Refunds', { parent: 'payments' })] } })
  test('70.2 the ✓ button accepts one ghost', async ({ page, werk }) => {
    await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
    await page.locator(`${card('refunds')} > a`).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
    const before = werk.logLines().length
    await page.getByRole('button', { name: /✓|Accept/ }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    const lines = werk.logLines()
    expect(lines.length).toBe(before + 1)
    expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
    await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
    await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
    const tile = page.locator(`[aria-label="map"] > ${card('payments')} > ul > ${card('refunds')}`)
    await expect(tile).toHaveAttribute('data-proposed', 'false')
    await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  })
})

test.describe('70.3', () => {
  test.use({
    log: { events: [...base, ...ghost('refunds', 'Refunds', { parent: 'payments' }), ...ghost('partial', 'Partial refunds', { parent: 'refunds' })] },
  })
  test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page }) => {
    await page.locator(`${card('partial')} > a`).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'partial')
    await page.getByRole('button', { name: /✓|Accept/ }).click()
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
})

test.describe('70.4', () => {
  test.use({
    log: {
      events: [
        ...base,
        ...ghost('refunds', 'Refunds', { parent: 'payments' }),
        ...ghost('chargebacks', 'Chargebacks', { parent: 'payments' }),
        { type: 'node.proposed', payload: { id: 'opt', kind: 'option', title: 'Store credit only', whyNot: 'Users want money back' } },
        { type: 'edge.linked', payload: { from: 'opt', to: 'refunds', type: 'alternative_to' } },
        { type: 'node.proposed', payload: { id: 'src', kind: 'source', title: 'Refund policy doc' } },
        { type: 'edge.linked', payload: { from: 'refunds', to: 'src', type: 'supported_by' } },
      ],
    },
  })
  test('70.4 an accept takes only the accepted branch', async ({ page, werk }) => {
    await expect(page.locator(card('refunds'))).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(0)
    await page.locator(`${card('refunds')} > a`).click()
    await expect(page.getByRole('button')).toHaveCount(1)
    await page.getByRole('button', { name: /✓|Accept/ }).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    await page.goto(`${werk.url}#opt`)
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    await page.goto(`${werk.url}#src`)
    await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
    await page.goto(werk.url)
    const cb = page.locator(`${card('payments')} > ul > ${card('chargebacks')} > a`)
    await expect(cb).toHaveCSS('border-top-style', 'dashed')
    await expect(cb).toHaveCSS('color', GREY)
    await expect(page.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
    await expect(page.getByRole('button')).toHaveCount(0)
  })
})

test.describe('70.5', () => {
  test.use({ log: { events: [...base, ...ghost('refunds', 'Refunds', { parent: 'payments' })] } })
  test('70.5 a second view sees the accept', async ({ page, werk, context }) => {
    const second = await context.newPage()
    await second.goto(werk.url)
    await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
    await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
    await page.locator(`${card('refunds')} > a`).click()
    await page.getByRole('button', { name: /✓|Accept/ }).click()
    await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
    await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  })
})
