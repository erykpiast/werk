import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

const GREY = 'rgb(138, 138, 138)'

test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  const root = map.locator(`> ${card('werk')}`)
  await expect(root.locator('> a')).toBeVisible()
  await expect(root.locator(`> ul > ${card('log')}`)).toBeVisible()
  await expect(root.locator(`> ul > ${card('map')}`)).toBeVisible()
  await expect(root.locator(`> ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(root.locator(`> ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log', { exact: false })).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aol', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li').first()).toBeVisible()
  const cardsBefore = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }

  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  second.stderr.on('data', (c: Buffer) => (err += c.toString()))
  second.stdout.on('data', (c: Buffer) => (err += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 15_000)
    second.on('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const took = Date.now() - started
  expect(err).toMatch(new RegExp(`wait\\w* for pid ${lock.pid}\\b`))
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8_000)
  const lines = err.split('\n')
  const waitIdx = lines.findIndex((l) => /waiting/.test(l))
  expect(lines.slice(waitIdx + 1).join('\n')).toContain(String(lock.pid))

  await page.goto(werk.url)
  await expect(map.locator('li').first()).toBeVisible()
  const cardsAfter = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(cardsAfter).toEqual(cardsBefore)
})

// ---- 70: ghosts in the browser

function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments', '--parent', 'werk'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expect(refunds).toHaveCSS('border-top-style', 'dashed')
  await expect(refunds).toHaveCSS('color', GREY)
  const pay = page.locator(`${card('payments')} > a`)
  await expect(pay).toContainText('Payments')
  await expect(pay).not.toHaveCSS('border-top-style', 'dashed')
  await expect(pay).not.toHaveCSS('color', GREY)
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  const before = logLines(werk).length
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(werk.url)
  await page.locator(`${card('partial')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'partial')
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  const chain = page.locator(`${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial')}`)
  await expect(chain).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(chain.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(page.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch, not other ghosts', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refund-opt', '--kind', 'option', '--title', 'Store credit instead', '--why-not', 'People want money'])
  werk.cli(['link', 'refund-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refund-src', '--kind', 'source', '--title', 'Refund policy notes'])
  werk.cli(['link', 'refunds', 'refund-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('navigation', { name: 'breadcrumbs' }).getByRole('link', { name: 'The map' }).click()
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('refund-opt'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('refund-src'))).toHaveAttribute('data-proposed', 'false')
  const cb = page.locator(`${card('payments')} > ul > ${card('chargebacks')} > a`)
  await expect(cb).toHaveCSS('border-top-style', 'dashed')
  await expect(cb).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk, context }) => {
  payments(werk)
  await page.goto(werk.url)
  const second = await context.newPage()
  await second.goto(werk.url)
  for (const pg of [page, second]) await expect(pg.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})
