import { expect, test } from '@playwright/test'
import { ctx, Project, setup } from './common.ts'

test('02.1 a retitle appends one event and the map shows only the new title', async () => {
  const p = (ctx.p = new Project())
  expect(p.events()).toEqual([])
  expect(p.werk('add', 'a', '--title', 'Use a log').code).toBe(0)
  expect(p.werk('add', 'b', '--title', 'Cards fold from it').code).toBe(0)
  expect(p.werk('link', 'b', 'a', '--type', 'refines').code).toBe(0)
  const saved = p.log()
  const r = p.werk('retitle', 'a', 'Use an append-only log')
  expect(r.code, `retitle output: ${r.out}`).toBe(0)
  const now = p.log()
  expect(now.split('\n').filter(Boolean).length).toBe(saved.split('\n').filter(Boolean).length + 1)
  expect(now.startsWith(saved)).toBe(true)
  const root = p.show()
  const a = root.children.find((c: any) => c.id === 'a')
  expect(a.title).toBe('Use an append-only log')
  expect(JSON.stringify(root)).not.toContain('"Use a log"')
  const showA = p.werk('show', 'a').stdout
  expect(showA).toContain('Use an append-only log')
  expect(JSON.parse(showA).card.title).toBe('Use an append-only log')
  expect(now).toContain('Use a log')
})

test('02.2 a card added from the command line appears in an open page without a reload', async ({ page }) => {
  const { p, s } = await setup((p) => p.real('a', 'Use an append-only log'))
  await page.goto(`${s.url}/#a`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  await page.evaluate(() => Object.assign(window, { __noReload: true }))
  expect(p.werk('add', 'c', '--title', 'Fold is pure').code).toBe(0)
  expect(p.werk('link', 'c', 'a', '--type', 'refines').code).toBe(0)
  const sub = page.getByRole('region', { name: 'sub-cards' })
  await expect(sub.getByRole('link', { name: 'Fold is pure' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use an append-only log')
  expect(await page.evaluate(() => (window as any).__noReload)).toBe(true)
})

test('02.3 a status change from the command line shows in the browser and in the command line', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.real('a', 'Use an append-only log', '--who', 'me')
    p.ok('edit', 'a', '--no-basis', 'the first decision of the project')
    p.ok('kill', 'a', 'a reader needs random access')
  })
  await page.goto(`${s.url}/#a`)
  const status = page.getByRole('region', { name: 'card detail' }).locator('.meta .status').first()
  await expect(status).toHaveText('open')
  await page.evaluate(() => Object.assign(window, { __noReload: true }))
  const before = p.events().length
  const r = p.werk('status', 'a', 'decided')
  expect(r.code, r.out).toBe(0)
  await expect(status).toHaveText('decided')
  expect(await page.evaluate(() => (window as any).__noReload)).toBe(true)
  expect(p.show('a').card.status).toBe('decided')
  const events = p.events()
  expect(events.length).toBe(before + 1)
  expect(events.at(-1)).toMatchObject({ type: 'decided', id: 'a', seq: before + 1 })
})

test('02.4 a card id in the location hash opens that card', async ({ page }) => {
  const { s } = await setup((p) => {
    p.real('a', 'Use an append-only log')
    p.real('b', 'Cards fold from it', '--parent', 'a')
  })
  await page.goto(`${s.url}/#b`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await expect(page.getByRole('region', { name: 'card detail' })).toContainText('#b')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  await expect(page).toHaveURL(/#b$/)
})

test('02.5 a page control changes a card only by appending an event', async ({ page }) => {
  // The only control on the page is the ✓ on a proposed card, so card "b" is a proposal.
  const { p, s } = await setup((p) => {
    p.real('a', 'Use an append-only log')
    p.ok('add', 'b', '--title', 'Cards fold from it', '--parent', 'a')
  })
  const saved = p.log()
  await page.goto(`${s.url}/#b`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cards fold from it')
  const detail = page.getByRole('region', { name: 'card detail' })
  await expect(detail).toHaveClass(/ghost/)
  await detail.getByRole('button', { name: 'accept #b' }).click()
  await expect(detail).not.toHaveClass(/ghost/)
  const now = p.log()
  expect(now.split('\n').filter(Boolean).length).toBe(saved.split('\n').filter(Boolean).length + 1)
  expect(now.startsWith(saved)).toBe(true)
  const shown = p.show('b').card
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shown.title)
  await expect(detail.locator('.meta .status').first()).toHaveText(shown.status)
  expect(shown.proposed).toBeUndefined()
  await expect(detail.getByText('proposed')).toHaveCount(0)
})
