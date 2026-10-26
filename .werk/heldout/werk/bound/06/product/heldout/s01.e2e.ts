import { expect, test } from '@playwright/test'
import { Project, serve, type Served } from './helpers.ts'

let p: Project | undefined
let s: Served | undefined
test.afterEach(async () => {
  await s?.stop()
  p?.cleanup()
  s = p = undefined
})

test('01.1 werk serve in a project with no cards shows the empty map shell', async ({ page }) => {
  p = new Project({ werkDir: false })
  s = await serve(p.dir)
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(s.url)
  await expect(page.locator('#root header.bar')).toBeVisible()
  const isReact = await page.evaluate(() => Object.keys(document.getElementById('root')!).some((k) => k.startsWith('__reactContainer')))
  expect(isReact).toBe(true)
  await expect(page.getByRole('main', { name: 'map' })).toBeVisible()
  await expect(page.getByText('The map has no cards yet.')).toBeVisible()
  await expect(page.locator('main li')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
  expect(s.output()).not.toMatch(/error|exception|fail/i)
})
