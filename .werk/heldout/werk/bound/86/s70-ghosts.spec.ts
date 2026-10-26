import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const GREY = 'rgb(138, 138, 138)'
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
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

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(`${werk.url}#refunds`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  const before = logLines(werk).length
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
  await page.goto(werk.url)
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial`)
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'People want money back'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy doc'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(`${werk.url}#refunds`)
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('refunds-opt'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('refunds-src'))).toHaveAttribute('data-proposed', 'false')
  const cb = page.locator(`${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.goto(`${werk.url}#chargebacks`)
  await expect(page.getByRole('button')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /refunds/i })).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(`${werk.url}#refunds`)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  const tile = second.locator(card('refunds'))
  await expect(tile).toHaveAttribute('data-proposed', 'true')
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})
