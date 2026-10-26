import { spawn } from 'node:child_process'
import { addressOf, card, expect, real, stop, test, MAIN } from './harness.ts'

test.describe('69.1', () => {
  test.use({
    log: { events: [
      ...real('root', 'The root card'),
      ...real('kid1', 'First child', { parent: 'root' }),
      ...real('kid2', 'Second child', { parent: 'root' }),
      ...real('grand', 'The grandchild', { parent: 'kid1' }),
    ] },
  })
  test('69.1 the map shows the refines tree', async ({ page }) => {
    const map = page.getByRole('list', { name: 'map' })
    await expect(map.locator(`> ${card('root')} > a`)).toContainText('The root card')
    await expect(map.locator(`> ${card('root')} > ul > ${card('kid1')} > a`)).toContainText('First child')
    await expect(map.locator(`> ${card('root')} > ul > ${card('kid2')} > a`)).toContainText('Second child')
    await expect(map.locator(`> ${card('root')} > ul > ${card('kid1')} > ul > ${card('grand')} > a`)).toContainText('The grandchild')
    await expect(map.locator(`> ${card('root')} > ul > ${card('grand')}`)).toHaveCount(0)
  })
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log', { exact: false })).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'aolog', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aolog', '--actor', 'you'])
  const drawn = page.locator(`[aria-label="map"] > ${card('werk')} > ul > ${card('aolog')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no edit control', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
  await expect(page).toHaveURL(/#map$/)
})

test('69.4 a second server waits, then refuses', async ({ page, werk }) => {
  test.setTimeout(30_000)
  await expect(page.locator(card('werk'))).toBeVisible()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env: werk.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  second.stderr.on('data', (c: Buffer) => (err += c.toString()))
  const started = Date.now()
  const outcome = await Promise.race([
    addressOf(second).then((u) => ({ served: u })),
    new Promise<{ code: number | null }>((r) => second.on('exit', (code) => r({ code }))),
  ]).catch((e: Error) => ({ code: second.exitCode, error: e.message }))
  const elapsed = Date.now() - started
  await stop(second)
  expect(outcome, `second server: ${JSON.stringify(outcome)} stderr=${err}`).not.toHaveProperty('served')
  expect(err).toMatch(new RegExp(`wait\\w* for pid ${werk.pid}\\b`))
  expect(second.exitCode).not.toBe(0)
  expect(elapsed).toBeLessThan(8000)
  const lines = err.trim().split('\n')
  expect(lines.slice(1).join('\n')).toContain(String(werk.pid))
  await page.goto(werk.url)
  await expect(page.getByRole('list', { name: 'map' }).locator('li')).toHaveCount(7)
  await expect(page.locator(`${card('werk')} > a`)).toContainText('werk: a visual layer over Claude Code')
})
