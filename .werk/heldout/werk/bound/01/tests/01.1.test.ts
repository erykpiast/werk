import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { start, V0, type Proc } from './helpers.ts'

let server: Proc | undefined
let dir: string | undefined
afterAll(async () => {
  await server?.stop()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test('01.1 werk serve on a project with no cards shows the empty map shell', async () => {
  // Given a project directory with no cards in it
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'heldout-empty-')))
  // When the user runs `werk serve` in that project directory
  server = start(process.execPath, [join(V0, 'src', 'cli.ts'), 'serve'], dir)
  // And the user opens the address that the server prints
  const m = await server.waitFor(/(http:\/\/localhost:\d+)/)
  const url = m[1]!
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  await page.goto(url)
  // Then the browser shows a page that React renders
  await page.waitForSelector('#root main', { timeout: 15_000 })
  const reactRendered = await page.evaluate(() => {
    const root = document.getElementById('root') as any
    return Object.keys(root).some((k) => k.startsWith('__reactContainer'))
  })
  expect(reactRendered).toBe(true)
  // And the page shows an empty map shell with no cards on it
  const main = page.getByRole('main', { name: 'map' })
  expect(await main.isVisible()).toBe(true)
  expect(await page.getByRole('region', { name: 'sub-cards' }).count()).toBe(0)
  expect(await main.textContent()).toContain('The map has no cards yet.')
  await page.screenshot({ path: join(import.meta.dir, 'evidence-01.1.png'), fullPage: true })
  expect(await page.getByRole('alert').count()).toBe(0)
  await browser.close()
  // And the user sees no error on the page or in the server output
  expect(errors).toEqual([])
  expect(server.output()).not.toMatch(/error|exception|warn/i)
  console.log('server output:\n' + server.output())
}, 60_000)
