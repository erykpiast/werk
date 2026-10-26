import { expect, P, real, test, tile } from './h.ts'

const tree = () => [...real('root', { title: 'The root card' }), ...real('kid1', { title: 'Child one', parent: 'root' }), ...real('kid2', { title: 'Child two', parent: 'root' }), ...real('grand', { title: 'The grandchild', parent: 'kid1' })]

test('69.1 the map shows the fixture project as a refines tree', async ({ page, boot }) => {
  const p = await boot(tree())
  await page.goto(p.url)
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${tile('root')} > a`)).toContainText('The root card')
  await expect(map.locator(`> ${tile('root')} > ul > ${tile('kid1')} > a`)).toContainText('Child one')
  await expect(map.locator(`> ${tile('root')} > ul > ${tile('kid2')} > a`)).toContainText('Child two')
  await expect(map.locator(`> ${tile('root')} > ul > ${tile('kid1')} > ul > ${tile('grand')} > a`)).toContainText('The grandchild')
  await expect(map.locator(`> ${tile('root')} > ul > ${tile('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, boot }) => {
  const p = await boot(tree())
  await page.goto(p.url)
  await expect(page.locator(tile('root'))).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  await page.evaluate(() => Object.assign(window, { stillOpen: true }))
  p.ok(['add', 'aol', '--title', 'Use an append-only log', '--parent', 'root'])
  p.ok(['accept', 'aol', '--actor', 'you'])
  const drawn = page.locator(`${tile('root')} > ul > ${tile('aol')}`)
  await expect(drawn).toContainText('Use an append-only log', { timeout: 5000 })
  await expect(drawn).toHaveAttribute('data-proposed', 'false', { timeout: 5000 })
  expect(await page.evaluate(() => (window as { stillOpen?: boolean }).stillOpen)).toBe(true)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page, boot }) => {
  const p = await boot(tree().concat([P('x')].slice(0, 0)))
  await page.goto(p.url)
  await page.locator(`${tile('kid1')} > a`).click()
  await expect(page).toHaveURL(/#kid1$/)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'kid1')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Child one')
  await expect(page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'kid1')
  await expect(page).toHaveURL(/#kid1$/)
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, boot }) => {
  test.setTimeout(60_000)
  const p = await boot(tree())
  const firstPid = p.server.pid!
  await page.goto(p.url)
  await expect(page.locator(tile('grand'))).toBeVisible()
  const before = await page.locator('li[data-card-id]').count()
  const second = p.spawnServer()
  const t0 = Date.now()
  const code = await new Promise<number | null>((r) => second.on('exit', (c) => r(c)))
  const took = Date.now() - t0
  expect(second.err).toContain(`waiting for pid ${firstPid}`)
  expect(code).not.toBe(0)
  expect(took).toBeLessThan(8000)
  expect(took).toBeGreaterThan(3000)
  expect(second.err).toMatch(new RegExp(`pid ${firstPid}\\b[\\s\\S]*`))
  expect(second.err.split('\n').filter((l) => l.includes(String(firstPid))).length).toBeGreaterThanOrEqual(2)
  await page.goto(p.url)
  await expect(page.locator('li[data-card-id]')).toHaveCount(before)
  await expect(page.locator(`${tile('root')} > a`)).toContainText('The root card')
})
