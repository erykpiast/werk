import { expect, P, real, test, tile, L } from './h.ts'

const GREY = 'rgb(138, 138, 138)'
const base = () => [...real('payments', { title: 'Payments' }), P('refunds', { title: 'Refunds', parent: 'payments' })]

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, boot }) => {
  const p = await boot(real('payments', { title: 'Payments' }))
  p.ok(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(p.url)
  const ghost = page.locator(`${tile('payments')} > ul > ${tile('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  await expect(ghost).toHaveCSS('color', GREY)
  const realTile = page.locator(`${tile('payments')} > a`)
  await expect(realTile).not.toHaveCSS('border-top-style', 'dashed')
  await expect(realTile).not.toHaveCSS('color', GREY)
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, boot }) => {
  const p = await boot(base())
  await page.goto(p.url)
  await page.locator(`${tile('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  const before = p.log().length
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const log = p.log()
  expect(log.length).toBe(before + 1)
  expect(log.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'The map' }).first().click()
  const t = page.locator(`${tile('payments')} > ul > ${tile('refunds')} > a`)
  await expect(t).toBeVisible()
  await expect(t).not.toHaveCSS('border-top-style', 'dashed')
  await expect(t).not.toHaveCSS('color', GREY)
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, boot }) => {
  const p = await boot([...base(), P('partial', { title: 'Partial refunds', parent: 'refunds' })])
  await page.goto(p.url)
  await page.locator(`${tile('partial')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('link', { name: 'The map' }).first().click()
  const chain = `${tile('payments')} > ul > ${tile('refunds')} > ul > ${tile('partial')}`
  await expect(page.locator(chain)).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${tile('payments')} > ul > ${tile('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${chain} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await expect(page.locator(`${tile('payments')} > ul > ${tile('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, boot }) => {
  const p = await boot([
    ...base(),
    P('chargebacks', { title: 'Chargebacks', parent: 'payments' }),
    P('opt', { kind: 'option', title: 'Refund by cheque', whyNot: 'slow' }),
    L('opt', 'refunds', 'alternative_to'),
    P('src', { kind: 'source', title: 'Refund policy' }),
    L('refunds', 'src', 'supported_by'),
  ])
  await page.goto(p.url)
  await expect(page.locator(`${tile('chargebacks')}`)).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${tile('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${p.url}#opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${p.url}#src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(p.url)
  const cb = page.locator(`${tile('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, boot }) => {
  const p = await boot(base())
  const second = await page.context().newPage()
  await page.goto(p.url)
  await second.goto(p.url)
  await expect(page.locator(tile('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(tile('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${tile('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(second.locator(tile('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${tile('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})
