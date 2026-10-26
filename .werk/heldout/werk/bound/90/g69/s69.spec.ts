/** Held-out steps 69.1–69.4: the map in a browser. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { card, realCard, seed } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')

test('69.1 the map shows the fixture project as a refines tree', async ({ page, werk }) => {
  // Given a project with a root card, two child cards that refine the root, and one grandchild card that refines a child
  seed(werk, [
    ...realCard('h-root', 'Held-out root'),
    ...realCard('h-child1', 'Held-out child one', { parent: 'h-root' }),
    ...realCard('h-child2', 'Held-out child two', { parent: 'h-root' }),
    ...realCard('h-grand', 'Held-out grandchild', { parent: 'h-child1' }),
  ])
  // When the person opens the map in a browser
  await page.goto(werk.url)
  const map = page.getByRole('list', { name: 'map' })
  // Then the person sees the root card
  await expect(map.locator(`> ${card('h-root')} > a`)).toContainText('Held-out root')
  // And the two child cards under the root card
  await expect(map.locator(`> ${card('h-root')} > ul > ${card('h-child1')} > a`)).toContainText('Held-out child one')
  await expect(map.locator(`> ${card('h-root')} > ul > ${card('h-child2')} > a`)).toContainText('Held-out child two')
  // And the grandchild under its parent card, not under the root card
  await expect(map.locator(`> ${card('h-root')} > ul > ${card('h-child1')} > ul > ${card('h-grand')}`)).toBeVisible()
  await expect(map.locator(`> ${card('h-root')} > ul > ${card('h-grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  // Given the map is open, root card is "werk" in the fixture
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(card('werk'))).toBeVisible()
  await expect(page.getByText('Use an append-only log', { exact: false })).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { heldoutNoReload: true }))
  // When the person adds and accepts the card from the command line
  werk.cli(['add', 'append-only', '--title', 'Use an append-only log', '--parent', 'werk'])
  werk.cli(['accept', 'append-only', '--actor', 'you'])
  // Then the map shows it under the root within a few seconds
  const drawn = map.locator(`> ${card('werk')} > ul > ${card('append-only')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  // But no reload
  expect(await page.evaluate(() => (window as { heldoutNoReload?: boolean }).heldoutNoReload)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page }) => {
  // When the person opens a child card from the map
  await page.locator(`${card('map')} > a`).click()
  // Then the address bar shows the id
  await expect(page).toHaveURL(/#map$/)
  // And the page shows the detail
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Draw the map in a browser')
  // And no text box or button that changes title or body
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  // When the person reloads the page
  await page.reload()
  // Then the same card opens again
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'map')
  await expect(page).toHaveURL(/#map$/)
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, werk }) => {
  test.setTimeout(30_000)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator('li').first()).toBeVisible()
  const before = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  const lock = JSON.parse(readFileSync(join(werk.dir, '.werk', 'server.lock'), 'utf8')) as { pid: number }
  const firstPid = lock.pid

  // When the person starts a second server on the same project directory
  const env = { ...process.env }
  delete env.WERK_LOG
  const started = Date.now()
  const second = spawn('bun', [MAIN, 'serve', '--port', '0'], { cwd: werk.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let firstWaitAt: number | undefined
  const onData = (c: Buffer) => {
    out += c.toString()
    if (firstWaitAt === undefined && /wait/i.test(out)) firstWaitAt = Date.now()
  }
  second.stdout.on('data', onData)
  second.stderr.on('data', onData)
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => {
      second.kill('SIGKILL')
      resolve(-999)
    }, 15_000)
    second.once('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  const elapsed = Date.now() - started
  // Then it prints that it waits for the pid of the first server
  expect(out).toMatch(new RegExp(`wait[^\\n]*${firstPid}`, 'i'))
  // And within about 5 seconds it stops with an error
  expect(code).not.toBe(-999)
  expect(code).not.toBe(0)
  expect(elapsed).toBeLessThan(8000)
  // And the error names the first server's pid
  const afterWait = out.split('\n').filter((l) => !/waiting/i.test(l)).join('\n')
  expect(afterWait).toContain(String(firstPid))
  // And the map still loads from the first server with the same cards
  await page.goto(werk.url)
  await expect(map.locator('li').first()).toBeVisible()
  const after = await map.locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))
  expect(after).toEqual(before)
})
