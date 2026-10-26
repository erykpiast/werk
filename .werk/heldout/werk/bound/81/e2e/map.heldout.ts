/** Held-out map specs, on the product's browser harness: a real server on a copy of the fixture project. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`

// The fixture: root "werk"; "log" and "map" refine it; "fold" refines "log".
test('69.1', async ({ page }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('werk')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > a`)).toContainText('werk: a visual layer over Claude Code')
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('map')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')}`)).toBeVisible()
  await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
})

test('69.2', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  werk.cli(['add', 'append-only', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'append-only', '--actor', 'you'])
  await expect(page.locator(`${card('werk')} > ul > ${card('append-only')}`)).toContainText('Use an append-only log', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3', async ({ page }) => {
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

test('69.4', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const firstPid = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')).pid as number

  const { WERK_LOG: _, ...env } = process.env
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  second.stdout.on('data', (c: Buffer) => (output += c.toString()))
  second.stderr.on('data', (c: Buffer) => (output += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(null)
    }, 15_000)
    second.on('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const seconds = (Date.now() - started) / 1000

  expect(output).toMatch(new RegExp(`wait\\w* for pid ${firstPid}\\b`))
  expect(code).not.toBeNull()
  expect(code).not.toBe(0)
  expect(seconds).toBeLessThan(7)
  expect(output.split('\n').filter((l) => !/wait/.test(l)).join('\n')).toContain(String(firstPid))

  await page.goto(werk.url)
  await expect(page.locator(card('werk'))).toBeVisible()
  const after = await page.locator('li[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(after).toEqual(before)
})
