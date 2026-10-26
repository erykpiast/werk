import { afterAll, expect, test } from 'bun:test'
import { closeBrowser, getBrowser, makeProject, startServe } from './lib.ts'

afterAll(closeBrowser)

test('01.1 werk serve in an empty project shows the empty React map shell', async () => {
  const project = makeProject()
  const server = await startServe(project.dir) // `werk serve --port 0`
  try {
    const url = server.output().match(/at (http:\/\/localhost:\d+) /)![1]!
    const browser = await getBrowser()
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(url)
    await page.getByRole('main', { name: 'map' }).waitFor({ timeout: 15000 })
    // React renders: the root container carries React's own container key, and has DOM content.
    const reactRoot = await page.evaluate(() => {
      const root = document.getElementById('root')!
      return { react: Object.keys(root).some((k) => k.startsWith('__reactContainer')), html: root.innerHTML.length }
    })
    expect(reactRoot.react).toBe(true)
    expect(reactRoot.html).toBeGreaterThan(0)
    // Empty map shell: no sub-cards, the empty notice.
    await expect(page.getByRole('region', { name: 'sub-cards' }).count()).resolves.toBe(0)
    expect(await page.getByText('The map has no cards yet.').isVisible()).toBe(true)
    expect(await page.locator('[role=alert]').count()).toBe(0)
    expect(errors).toEqual([])
    expect(server.output()).not.toMatch(/error/i)
    await page.close()
  } finally {
    await server.stop()
    project.cleanup()
  }
}, 60_000)
