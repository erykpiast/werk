import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`
const logLines = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; actor: string; payload: { id?: string } })

test('69.1 the map shows the fixture project as a refines tree', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('werk')} > a`)).toContainText('werk: a visual layer over Claude Code')
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('map')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { s69Still: true }))
  werk.cli(['add', 'aolog', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aolog', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aolog')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { s69Still?: boolean }).s69Still)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('log')} > a`).click()
  await expect(page).toHaveURL(/#log$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'log')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Store the map as an append-only event log')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#log$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'log')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li')).toHaveCount(7)
  const before = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  const env = { ...process.env, HOME: join(werk.dir, '..'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
  delete (env as Record<string, string | undefined>).WERK_LOG
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => (out += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 12_000)
    second.on('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const took = Date.now() - started
  console.log(`second server exit ${code} after ${took}ms:\n${out}`)
  expect(out).toContain(`waiting for pid ${lock.pid}`)
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  expect(out).toMatch(new RegExp(`(pid ${lock.pid})[^]*another werk|another werk[^]*pid ${lock.pid}`))

  await page.reload()
  await expect(map.locator('li')).toHaveCount(7)
  const after = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(after).toEqual(before)
})

async function paymentsWithGhost(werk: Werk) {
  werk.cli(['add', 'payments', '--title', 'Payments'])
  werk.cli(['accept', 'payments', '--actor', 'you'])
  werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
}

test('70.1 a proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  await paymentsWithGhost(werk)
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  const ghost = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  await expect(ghost).toContainText('Refunds')
  await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  await expect(ghost).toHaveCSS('color', 'rgb(138, 138, 138)')
  const real = map.locator(`> ${card('payments')} > a`)
  await expect(real).toContainText('Payments')
  await expect(real).not.toHaveCSS('border-top-style', 'dashed')
  await expect(real).not.toHaveCSS('color', 'rgb(138, 138, 138)')
})

test('70.2 the person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  await paymentsWithGhost(werk)
  await page.goto(werk.url)
  await expect(page.locator(`${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'refunds')
  const before = logLines(werk).length
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(detail).toHaveAttribute('data-proposed', 'false')
  await expect(page.getByRole('button', { name: 'Accept #refunds' })).toHaveCount(0)
  const lines = logLines(werk)
  expect(lines.length).toBe(before + 1)
  expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  await page.locator('nav[aria-label="breadcrumbs"] a', { hasText: 'The map' }).click()
  const tile = page.locator(`${card('payments')} > ul > ${card('refunds')}`)
  await expect(tile).toHaveAttribute('data-proposed', 'false')
  await expect(tile.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
})

test('70.3 accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  await paymentsWithGhost(werk)
  werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  await page.goto(werk.url)
  await expect(page.locator(`${card('refunds')} > ul > ${card('partial')}`)).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('partial')} > a`).click()
  await page.getByRole('button', { name: 'Accept #partial' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.locator('nav[aria-label="breadcrumbs"] a', { hasText: 'The map' }).click()
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('payments')} > ul > ${card('refunds')}`)).toHaveAttribute('data-proposed', 'false')
  await expect(map.locator(`> ${card('payments')} > ul > ${card('refunds')} > ul > ${card('partial')}`)).toHaveAttribute(
    'data-proposed',
    'false',
  )
  await expect(page.locator(`${card('partial')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await expect(page.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
})

test("70.4 an accept takes only the accepted card's branch, not other ghosts", async ({ page, werk }) => {
  await paymentsWithGhost(werk)
  werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  werk.cli(['add', 'refunds-opt', '--kind', 'option', '--title', 'Refund by store credit', '--why-not', 'Users want cash'])
  werk.cli(['link', 'refunds-opt', 'refunds', '--type', 'alternative_to'])
  werk.cli(['add', 'refunds-src', '--kind', 'source', '--title', 'The refunds policy'])
  werk.cli(['link', 'refunds', 'refunds-src', '--type', 'supported_by'])
  await page.goto(werk.url)
  await expect(page.locator(card('refunds-opt'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.locator(card('refunds-src'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.goto(`${werk.url}#refunds`)
  await expect(page.getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  await page.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('refunds-opt'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('refunds-src'))).toHaveAttribute('data-proposed', 'false')
  await expect(page.locator(card('chargebacks'))).toHaveAttribute('data-proposed', 'true')
  await expect(page.locator(`${card('chargebacks')} > a`)).toHaveCSS('border-top-style', 'dashed')
  await expect(page.locator(`${card('chargebacks')} > a`)).toHaveCSS('color', 'rgb(138, 138, 138)')
  await expect(page.getByRole('button')).toHaveCount(0)
})

test('70.5 a second view sees the accept because it reads the same log', async ({ page, werk }) => {
  await paymentsWithGhost(werk)
  await page.goto(werk.url)
  const second = await page.context().newPage()
  await second.goto(werk.url)
  await expect(page.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'true')
  await page.locator(`${card('refunds')} > a`).click()
  await page.getByRole('button', { name: 'Accept #refunds' }).click()
  await expect(second.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  await expect(second.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  await second.close()
})
