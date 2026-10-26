/**
 * Steps 72.x: stale and paused marks in the map.
 * Setup of a decided card: add --who prototype, accept --actor you, then either
 * edit --no-basis (a root card) or link depends_on (a dependent), kill --form manual, status decided.
 * "--who prototype" removes the options fact (contract.ts). A reopen needs a decided card, so
 * card A (and X) is decided in every scenario.
 * Colours: "red" = r > 150, g < 80, b < 80. "grey" = |r-g|, |g-b|, |r-b| all < 10.
 */
import { expect, test, type Werk } from './harness.ts'

function decided(werk: Werk, id: string, title: string, dependsOn: string[] = []) {
  werk.cli(['add', id, '--title', title, '--who', 'prototype'])
  werk.cli(['accept', id, '--actor', 'you'])
  if (dependsOn.length === 0) werk.cli(['edit', id, '--no-basis', 'a root card'])
  for (const to of dependsOn) werk.cli(['link', id, to, '--type', 'depends_on', '--why', `${id} takes ${to}`])
  werk.cli(['kill', id, '--form', 'manual', '--text', 'check by use'])
  werk.cli(['status', id, 'decided'])
}

const rgb = (s: string) => {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) throw new Error(`not a colour: ${s}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])] as const
}
const isRed = (s: string) => {
  const [r, g, b] = rgb(s)
  return r > 150 && g < 80 && b < 80
}
const isGrey = (s: string) => {
  const [r, g, b] = rgb(s)
  return Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10
}

const tile = (page: import('@playwright/test').Page, id: string) => page.locator(`li[data-card-id="${id}"] > a`)
const markOf = (page: import('@playwright/test').Page, id: string) => tile(page, id).locator('> .mark')
const bg = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
const stripe = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).borderLeftColor)

function chain(werk: Werk) {
  decided(werk, 'a', 'Card A')
  decided(werk, 'b', 'Card B', ['a'])
  decided(werk, 'c', 'Card C', ['b'])
}

test('72.1 A rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  const mb = markOf(page, 'b')
  await expect(mb).toHaveCount(1)
  await expect(mb).toHaveText('stale')
  const bBg = await bg(mb)
  expect(isRed(bBg), `stale mark background ${bBg}`).toBe(true)
  await expect(tile(page, 'b')).toHaveAttribute('data-status', 'decided')
  const decidedStripe = await stripe(tile(page, 'b'))
  expect(decidedStripe).toBe('rgb(46, 125, 50)')
  await expect(markOf(page, 'c').filter({ hasText: 'stale' })).toHaveCount(0)
  await expect(markOf(page, 'c').filter({ hasText: 'paused' })).toHaveCount(0)
  await expect(markOf(page, 'c')).toHaveCount(0)
})

test('72.2 A postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  for (const id of ['b', 'c']) {
    const m = markOf(page, id)
    await expect(m).toHaveCount(1)
    await expect(m).toHaveText('paused')
    const c = await bg(m)
    expect(isGrey(c), `paused mark of ${id} background ${c}`).toBe(true)
    expect(isRed(c)).toBe(false)
  }
  await expect(tile(page, 'c')).toHaveAttribute('data-status', 'decided')
  expect(await stripe(tile(page, 'c'))).toBe('rgb(46, 125, 50)')
  await expect(page.locator('li[data-card-id="b"] > a > .mark[data-mark="stale"]')).toHaveCount(0)
  await expect(page.locator('li[data-card-id="c"] > a > .mark[data-mark="stale"]')).toHaveCount(0)
})

test('72.3 The card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  decided(werk, 'a', 'Card A')
  decided(werk, 'b', 'Card B', ['a'])
  werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'b').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible()
  const item = marks.locator('li').first()
  await expect(item).toContainText('#a')
  await expect(item).toContainText('was reopened')
  await expect(item).toContainText('depends_on')
  await expect(item).toContainText('rejected')
  await expect(item).toContainText('The vendor dropped this API')
})

test('72.4 The card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'c').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect.soft(marks.getByRole("heading", { name: /Why this card is stale/ })).toBeVisible()
  const item = marks.locator('li').first()
  await expect(item).toContainText('#a')
  await expect(item).toContainText('was reopened')
  await expect(item).toContainText('postponed')
  await expect(item).toContainText('We build the engine next quarter')
})

test('72.5 A stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decided(werk, 'a', 'Card A')
  decided(werk, 'x', 'Card X')
  decided(werk, 'b', 'Card B', ['a', 'x'])
  werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(werk.url)
  const m = markOf(page, 'b')
  await expect(m).toHaveCount(1)
  await expect(m).toHaveText('stale')
  const c = await bg(m)
  expect(isRed(c), `mark background ${c}`).toBe(true)
  await expect(page.locator('li[data-card-id="b"] > a .mark[data-mark="paused"]')).toHaveCount(0)
  await tile(page, 'b').click()
  const marks = page.getByRole('region', { name: 'marks' })
  const itemA = marks.locator('li[data-cause="a"]')
  await expect(itemA).toHaveCount(1)
  await expect(itemA).toContainText('#a')
  await expect(itemA).toContainText('rejected')
})
