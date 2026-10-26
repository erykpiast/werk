import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../../e2e/harness.ts'

const MAIN = join(import.meta.dirname, '..', '..', '..', 'src', 'cli', 'main.ts')
const card = (id: string) => `li[data-card-id="${id}"]`

// 69.1
// Scenario: The map shows the fixture project as a refines tree
// Given a project with a root card, two child cards that refine the root, and one grandchild card that refines a child
// And the person starts the server on that project
// When the person opens the map in a browser
// Then the person sees the root card
// And the person sees the two child cards under the root card
// And the person sees the grandchild card under its parent card, not under the root card
test('69.1 the fixture shows as a refines tree', async ({ page }) => {
  // The fixture: root #werk, children #log and #map, grandchild #fold under #log.
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('werk')} > a`)).toContainText('werk: a visual layer over Claude Code')
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > a`)).toContainText('Store the map as an append-only event log')
  await expect(map.locator(`> ${card('werk')} > ul > ${card('map')} > a`)).toContainText('Draw the map in a browser')
  await expect(map.locator(`> ${card('werk')} > ul > ${card('log')} > ul > ${card('fold')} > a`)).toContainText('Fold the cards from the log')
  await expect(map.locator(`> ${card('werk')} > ul > ${card('fold')}`)).toHaveCount(0)
  await expect(map.locator(`> ${card('fold')}`)).toHaveCount(0)
})

// 69.2
// Scenario: A card added and accepted from the command line appears with no reload
// Given the server runs on a project, and the person has the map open in a browser
// And the map does not show a card titled "Use an append-only log"
// When the person adds a card titled "Use an append-only log" under the root card from the command line
// And the person accepts that card from the command line
// Then the map shows the card "Use an append-only log" under the root card within a few seconds
// But the person did not reload the page or click anything in the browser
test('69.2 a card added and accepted on the command line appears with no reload', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillOpen6972: true }))

  werk.cli(['add', 'append-only', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'append-only', '--actor', 'you'])

  const drawn = map.locator(`> ${card('werk')} > ul > ${card('append-only')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { stillOpen6972?: boolean }).stillOpen6972)).toBe(true)
})

// 69.3
// Scenario: The open card survives a reload and has no control that edits its text
// Given the server runs on a project, and the person has the map open in a browser
// When the person opens a child card from the map
// Then the address bar shows the id of that card
// And the page shows the detail of that card
// And the page has no text box or button that changes the title or the body of the card
// When the person reloads the page
// Then the page opens the same card again, with the same id in the address bar
test('69.3 the open card survives a reload and has no edit control', async ({ page }) => {
  await page.locator(`${card('werk')} > ul > ${card('map')} > a`).click()
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
  await expect(page.getByTestId('card').getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
})

// 69.4
// Scenario: A second server on the same project waits, then refuses
// Given a server runs on a project
// When the person starts a second server on the same project directory
// Then the second server prints that it waits for the process id of the first server
// And within about 5 seconds the second server stops with an error
// And the error names the process id of the first server
// And the map in the browser still loads from the first server and shows the same cards as before
test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(card('werk'))).toBeVisible()
  const before = (await map.locator('li').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-card-id')))).sort()

  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  const firstPid = lock.pid
  expect(typeof firstPid).toBe('number')

  const env = { PATH: process.env.PATH ?? '', HOME: werk.dir, TMPDIR: process.env.TMPDIR ?? '/tmp' }
  const startedAt = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  second.stdout.on('data', (c: Buffer) => (out += c.toString()))
  second.stderr.on('data', (c: Buffer) => (out += c.toString()))
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 15_000)
    second.once('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  const elapsed = Date.now() - startedAt
  console.log('second server output:', out, 'code:', code, 'elapsed ms:', elapsed, 'first pid:', firstPid)

  expect(out).toMatch(new RegExp(`wait\\w*[^\\n]*\\b${firstPid}\\b`))
  expect(code).not.toBe(0)
  expect(code).not.toBe(-999)
  expect(elapsed).toBeLessThan(8000)
  expect(elapsed).toBeGreaterThan(3000)
  // The error: the lines after the wait line.
  const error = out.trim().split('\n').slice(1).join('\n')
  expect(error).toContain(String(firstPid))

  await page.goto(werk.url)
  await expect(map.locator(card('werk'))).toBeVisible()
  const after = (await map.locator('li').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-card-id')))).sort()
  expect(after).toEqual(before)
})
