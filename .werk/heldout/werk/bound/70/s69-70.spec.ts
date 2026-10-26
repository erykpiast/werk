import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const events = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))

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
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'append-only', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'append-only', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('append-only')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5_000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
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
  await expect(page.locator(card('werk'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').allTextContents()
  const lock = readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')
  const firstPid = String(JSON.parse(lock).pid)
  const env = { ...process.env }
  delete env.WERK_LOG
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let waitLineAt = -1
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => {
    out += c.toString()
    if (waitLineAt < 0 && /wait/i.test(out)) waitLineAt = Date.now() - started
  })
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(null)
    }, 15_000)
    second.on('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const took = Date.now() - started
  const waitLine = out.split('\n').find((l) => /wait/i.test(l)) ?? ''
  expect(waitLine).toContain(firstPid)
  expect(code).not.toBeNull()
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8_000)
  const errorLines = out.split('\n').filter((l) => l !== waitLine)
  expect(errorLines.join('\n')).toContain(firstPid)
  await page.goto(werk.url)
  await expect(page.locator(card('werk'))).toBeVisible()
  expect(await page.locator('li[data-card-id]').allTextContents()).toEqual(before)
})

/** Payments as a real root card, and Refunds as a ghost under it. */
function payments(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}
const GREY = 'rgb(138, 138, 138)'

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  const refunds = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(refunds).toContainText('Refunds')
  await expect(refunds).toHaveCSS('border-top-style', 'dashed')
  await expect(refunds).toHaveCSS('color', GREY)
  const pay = map.locator(`> ${card('payments')} > a`)
  await expect(pay).not.toHaveCSS('border-top-style', 'dashed')
  await expect(pay).not.toHaveCSS('color', GREY)
})

test('70.2 the person accepts one ghost with the ✓ button', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  await page.locator(`${card('refunds')} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'refunds')
  const before = events(werk).length
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  const after = events(werk)
  expect(after.length).toBe(before + 1)
  expect(after.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await expect(page.getByRole('button', { name: /✓|Accept/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'The map' }).first().click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'partial-refunds', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(werk.url)
  await page.locator(`${card('partial-refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.getByRole('link', { name: 'The map' }).first().click()
  const refunds = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  const partial = refunds.locator(`> ul > ${card('partial-refunds')}`)
  await expect(partial).toHaveAttribute('data-proposed', 'false')
  await expect(refunds).toHaveAttribute('data-proposed', 'false')
  await expect(partial.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  await expect(refunds.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.4 an accept takes only the accepted card branch', async ({ page, werk }) => {
  payments(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Store credit only', '--why-not', 'people want money back'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'Card network rules'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  expect(werk.cli(['show', 'refunds-opt'])).toContain('state: real')
  expect(werk.cli(['show', 'refunds-src'])).toContain('state: real')
  await page.getByRole('link', { name: 'The map' }).first().click()
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  const charge = page.locator(`${card('chargebacks')} > a`)
  await expect(charge).toHaveCSS('border-top-style', 'dashed')
  await expect(charge).toHaveCSS('color', GREY)
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  payments(werk)
  await page.goto(werk.url)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: /✓|Accept/ }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})
