import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })
const GREY = 'rgb(138, 138, 138)'

// Fixture: root "werk"; children "log", "map" (and ghost "ghost"); grandchildren "fold" under log, "map-hash" under map.
test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('werk')} > a`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('map')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log', { exact: false })).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutMarker: 1 }))
  werk.cli(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aol', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutMarker?: number }).heldoutMarker)).toBe(1)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail).toContainText('Draw the map in a browser')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  await page.goto(werk.url)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expect(refunds).toHaveCSS('border-top-style', 'dashed')
  await expect(refunds).toHaveCSS('color', GREY)
  const payments = page.locator(`${card('payments')} > a`)
  await expect(payments).not.toHaveCSS('border-top-style', 'dashed')
  await expect(payments).not.toHaveCSS('color', GREY)
})

const paymentsWithRefunds = (werk: Werk) => {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  const before = logLines(werk).length
  await page.getByRole('button', { name: /Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /Accept/ })).toHaveCount(0)
  await page.locator('nav[aria-label="breadcrumbs"] a', { hasText: 'The map' }).click()
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(`${werk.url}#partial`)
  await page.getByRole('button', { name: /Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.locator('nav[aria-label="breadcrumbs"] a', { hasText: 'The map' }).click()
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(map.locator(`${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial')}`)).toHaveAttribute('data-proposed', 'false')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  paymentsWithRefunds(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'customers want money'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Refund policy doc'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.goto(`${werk.url}#refunds`)
  await page.getByRole('button', { name: /Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-opt`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(`${werk.url}#refunds-src`)
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  const cb = page.locator(`${card('payments')} > ul > ${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk, context }) => {
  paymentsWithRefunds(werk)
  const second = await context.newPage()
  await second.goto(werk.url)
  await page.goto(`${werk.url}#refunds`)
  const tile2 = second.locator(card('refunds'))
  await expect(tile2).toHaveAttribute('data-proposed', 'true')
  await page.getByRole('button', { name: /Accept/ }).click()
  await expect(tile2).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  await expect(tile2.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})
