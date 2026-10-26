import { test, expect } from '@playwright/test'
import { project, card, ghost, link, type Proj, type Server } from './werk.ts'

const li = (id: string) => `li[data-card-id="${id}"]`
const GREY = 'rgb(138, 138, 138)'
let p: Proj
let s: Server | undefined
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('evidence.png'), fullPage: true }).catch(() => {})
  await s?.stop()
  s = undefined
  p?.cleanup()
})

const base = () => card('payments', 'Payments')

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page }) => {
  p = project(base())
  expect(p.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments']).code).toBe(0)
  s = await p.serve()
  await page.goto(s.url)
  const ghostTile = page.locator(`${li('payments')} > ul > ${li('refunds')} > a`)
  await expect(ghostTile).toContainText('Refunds')
  await expect(ghostTile).toHaveCSS('color', GREY)
  await expect(ghostTile).toHaveCSS('border-top-style', 'dashed')
  const real = page.locator(`${li('payments')} > a`)
  await expect(real).toContainText('Payments')
  await expect(real).not.toHaveCSS('color', GREY)
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page }) => {
  p = project([...base(), ...ghost('refunds', 'Refunds', { parent: 'payments' })])
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  const before = p.log().length
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const log = p.log()
  expect(log.length).toBe(before + 1)
  expect(log.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'The map' }).first().click()
  const tile = page.locator(`${li('payments')} > ul > ${li('refunds')} > a`)
  await expect(tile).not.toHaveCSS('border-top-style', 'dashed')
  await expect(tile).not.toHaveCSS('color', GREY)
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page }) => {
  p = project([...base(), ...ghost('refunds', 'Refunds', { parent: 'payments' }), ...ghost('partial', 'Partial refunds', { parent: 'refunds' })])
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('partial')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('link', { name: 'The map' }).first().click()
  const chain = page.locator(`${li('payments')} > ul > ${li('refunds')} > ul > ${li('partial')}`)
  await expect(chain).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${li('payments')} > ul > ${li('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(chain.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page }) => {
  p = project([
    ...base(),
    ...ghost('refunds', 'Refunds', { parent: 'payments' }),
    ...ghost('chargebacks', 'Chargebacks', { parent: 'payments' }),
    { type: 'node.proposed', payload: { id: 'opt', kind: 'option', title: 'Store credit only', whyNot: 'users want money back' } },
    ...link('opt', 'refunds', 'alternative_to'),
    { type: 'node.proposed', payload: { id: 'src', kind: 'source', title: 'Refund policy doc' } },
    ...link('refunds', 'src', 'supported_by'),
  ])
  s = await p.serve()
  await page.goto(s.url)
  await expect(page.locator(li('chargebacks'))).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${li('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const g = await (await page.request.get(`${s.url}api/graph`)).json()
  const node = (id: string) => g.nodes.find((n: { id: string }) => n.id === id)
  expect(node('opt').proposed).toBeFalsy()
  expect(node('src').proposed).toBeFalsy()
  expect(node('chargebacks').proposed).toBe(true)
  await page.getByRole('link', { name: 'The map' }).first().click()
  await expect(page.locator(`${li('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  const cb = page.locator(`${li('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page }) => {
  p = project([...base(), ...ghost('refunds', 'Refunds', { parent: 'payments' })])
  s = await p.serve()
  const second = await page.context().newPage()
  await page.goto(s.url)
  await second.goto(s.url)
  await expect(page.locator(li('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(li('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${li('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(second.locator(li('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${li('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})
