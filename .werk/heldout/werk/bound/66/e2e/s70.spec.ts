import { card, expect, link, node, real, test, type Page } from './harness.ts'

const grey = async (page: Page, sel: string) =>
  page.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el)
    const [r, g, b] = s.color.match(/\d+/g)!.map(Number)
    return { dashed: s.borderTopStyle === 'dashed', grey: r === g && g === b && r! > 90 && r! < 210 }
  })

const base = [...real('payments', 'Payments'), node('refunds', 'Refunds', { parent: 'payments' })]

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, boot }) => {
  await boot({ log: base })
  const tile = `${card('payments')} > ul > ${card('refunds')} > a`
  await expect(page.locator(tile)).toContainText('Refunds')
  expect(await grey(page, tile)).toEqual({ dashed: true, grey: true })
  expect(await grey(page, `${card('payments')} > a`)).toEqual({ dashed: false, grey: false })
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, boot }) => {
  const werk = await boot({ log: base })
  await page.locator(`${card('refunds')} > a`).click()
  const before = werk.logLines().length
  await page.getByRole('button', { name: /✓|accept/i }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = werk.logLines()
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|accept/i })).toHaveCount(0)
  await page.getByRole('link', { name: 'The map' }).first().click()
  const tile = `${card('payments')} > ul > ${card('refunds')} > a`
  await expect(page.locator(tile)).toBeVisible()
  expect(await grey(page, tile)).toEqual({ dashed: false, grey: false })
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, boot }) => {
  await boot({ log: [...base, node('partial', 'Partial refunds', { parent: 'refunds' })] })
  await page.locator(`${card('partial')} > a`).first().click()
  await page.getByRole('button', { name: /✓|accept/i }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('link', { name: 'The map' }).first().click()
  const refunds = `${card('payments')} > ul > ${card('refunds')}`
  const partial = `${refunds} > ul > ${card('partial')}`
  await expect(page.locator(partial)).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(refunds)).toHaveAttribute('data-proposed', 'false')
  expect(await grey(page, `${partial} > a`)).toEqual({ dashed: false, grey: false })
  expect(await grey(page, `${refunds} > a`)).toEqual({ dashed: false, grey: false })
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, boot }) => {
  const werk = await boot({
    log: [
      ...base,
      node('chargebacks', 'Chargebacks', { parent: 'payments' }),
      node('refund-cash', 'Refund in cash', { kind: 'option', whyNot: 'No cash desk' }),
      link('refund-cash', 'refunds', 'alternative_to'),
      node('refund-law', 'The refund law', { kind: 'source' }),
      link('refunds', 'refund-law', 'supported_by'),
    ],
  })
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${card('refunds')} > a`).click()
  const buttons = page.getByRole('button')
  await expect(buttons).toHaveCount(1)
  await buttons.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('link', { name: 'The map' }).first().click()
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  const graph = (await (await page.request.get(`${werk.url}api/graph`)).json()) as { nodes: { id: string; proposed: boolean }[] }
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n.proposed]))
  expect({ option: byId['refund-cash'], source: byId['refund-law'] }).toEqual({ option: false, source: false })
  const cb = `${card('payments')} > ul > ${card('chargebacks')} > a`
  expect(await grey(page, cb)).toEqual({ dashed: true, grey: true })
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, boot }) => {
  const werk = await boot({ log: base })
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expect(second.locator(`${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  await expect(page.locator(`${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|accept/i }).click()
  await expect(second.locator(`${card('refunds')}`)).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  expect(await grey(second, `${card('refunds')} > a`)).toEqual({ dashed: false, grey: false })
  await second.close()
})
