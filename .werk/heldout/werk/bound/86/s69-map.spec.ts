import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

test('69.1 the map shows the project as a refines tree', async ({ page, werk }) => {
  werk.cli(['add', 'root69', '--title', 'Root card 69'])
  werk.cli(['add', 'kid1', '--title', 'Child one', '--parent', 'root69'])
  werk.cli(['add', 'kid2', '--title', 'Child two', '--parent', 'root69'])
  werk.cli(['add', 'grand', '--title', 'Grandchild', '--parent', 'kid1'])
  werk.cli(['accept', 'grand', '--actor', 'you'])
  werk.cli(['accept', 'kid2', '--actor', 'you'])
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('root69')} > a`)).toContainText('Root card 69')
  await expect(map.locator(`> ${card('root69')} > ul > ${card('kid1')} > a`)).toContainText('Child one')
  await expect(map.locator(`> ${card('root69')} > ul > ${card('kid2')} > a`)).toContainText('Child two')
  await expect(map.locator(`> ${card('root69')} > ul > ${card('kid1')} > ul > ${card('grand')} > a`)).toContainText('Grandchild')
  await expect(map.locator(`> ${card('root69')} > ul > ${card('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the CLI appears with no reload', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillOpen69: true }))
  werk.cli(['add', 'aolog', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'aolog', '--actor', 'you'])
  const drawn = page.locator(`${card('werk')} > ul > ${card('aolog')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { stillOpen69?: boolean }).stillOpen69)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  await page.locator(`${card('map')} > a`).click()
  await expect(page).toHaveURL(/#map$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#map$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  await expect(page.locator(card('werk'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').count()
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], {
    cwd: werk.dir,
    env: { PATH: process.env.PATH ?? '', HOME: join(werk.dir, '..') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => (out += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 15_000)
    second.on('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const took = Date.now() - started
  console.log('second server output:', out, 'code', code, 'ms', took)
  expect(out).toMatch(new RegExp(`wait\\w* for pid ${lock.pid}`))
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(took).toBeLessThan(8000)
  const afterWait = out.split(/wait\w* for pid \d+/)[1] ?? ''
  expect(afterWait).toContain(String(lock.pid))
  await page.goto(werk.url)
  await expect(page.locator(card('werk'))).toBeVisible()
  await expect(page.locator('li[data-card-id]')).toHaveCount(before)
})
