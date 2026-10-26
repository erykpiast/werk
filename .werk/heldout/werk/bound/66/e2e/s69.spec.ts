import { addressOf, card, expect, real, test } from './harness.ts'

const tree = [
  ...real('root', 'The root card'),
  ...real('child-a', 'Child A', { parent: 'root' }),
  ...real('child-b', 'Child B', { parent: 'root' }),
  ...real('grand', 'Grandchild of A', { parent: 'child-a' }),
]

test('69.1 the map shows the fixture project as a refines tree', async ({ page, boot }) => {
  await boot({ log: tree })
  const map = page.getByRole('list', { name: 'map' })
  await expect(map.locator(`> ${card('root')} > a`)).toContainText('The root card')
  await expect(map.locator(`> ${card('root')} > ul > ${card('child-a')} > a`)).toContainText('Child A')
  await expect(map.locator(`> ${card('root')} > ul > ${card('child-b')} > a`)).toContainText('Child B')
  await expect(map.locator(`> ${card('root')} > ul > ${card('child-a')} > ul > ${card('grand')} > a`)).toBeVisible()
  await expect(map.locator(`> ${card('root')} > ul > ${card('grand')}`)).toHaveCount(0)
})

test('69.2 a card added and accepted from the command line appears with no reload', async ({ page, boot }) => {
  const werk = await boot({ log: tree })
  await expect(page.getByRole('list', { name: 'map' }).locator(`> ${card('root')}`)).toBeVisible()
  await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  let reloads = 0
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) reloads++
  })
  werk.cli(['add', 'append-log', '--title', 'Use an append-only log', '--parent', 'root'])
  werk.cli(['accept', 'append-log', '--actor', 'you'])
  await expect(page.locator(`${card('root')} > ul > ${card('append-log')} > a`)).toContainText('Use an append-only log', { timeout: 5_000 })
  expect(reloads).toBe(0)
})

test('69.3 the open card survives a reload and has no control that edits its text', async ({ page, boot }) => {
  await boot({ log: tree })
  await page.locator(`${card('child-a')} > a`).click()
  await expect(page).toHaveURL(/#child-a$/)
  const detail = page.getByTestId('card')
  await expect(detail.getByRole('heading', { name: 'Child A' })).toBeVisible()
  await expect(page.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.reload()
  await expect(page).toHaveURL(/#child-a$/)
  await expect(page.getByTestId('card').getByRole('heading', { name: 'Child A' })).toBeVisible()
})

test('69.4 a second server on the same project waits, then refuses', async ({ page, boot }) => {
  const werk = await boot({ log: tree })
  await expect(page.locator(`${card('root')} > a`)).toBeVisible()
  const firstPid = werk.server.pid!
  const started = Date.now()
  const second = werk.spawnServer()
  const code = await new Promise<number | null>((resolve) => {
    second.on('exit', (c) => resolve(c))
    setTimeout(() => resolve(-999), 15_000)
  })
  const elapsed = Date.now() - started
  const err = second.err()
  expect(err).toContain(`waiting for pid ${firstPid}`)
  expect(code).not.toBe(-999)
  expect(code).not.toBe(0)
  expect(elapsed).toBeLessThan(8_000)
  const after = err.slice(err.indexOf('waiting for pid'))
  expect(after.split('\n').slice(1).join('\n')).toContain(String(firstPid))
  void addressOf

  await page.reload()
  await expect(page.locator(`${card('root')} > ul > ${card('child-a')}`)).toBeVisible()
  await expect(page.locator(`${card('root')} > ul > ${card('child-b')}`)).toBeVisible()
  await expect(page.locator(`${card('child-a')} > ul > ${card('grand')}`)).toBeVisible()
})
