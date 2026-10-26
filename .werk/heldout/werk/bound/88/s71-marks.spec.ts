/** Held-out group 72: stale and paused marks on the map. */
import { join } from 'node:path'
import { appendEvent } from '../src/map/log.ts'
import { accepted, killed, linked, noBasis, proposed, statusSet, whoSet } from '../src/test/map-events.ts'
import { expect, test, type Werk } from '../e2e/harness.ts'

const GREEN = 'rgb(46, 125, 50)'
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'

/** Appends decided cards and depends_on links to the copy's decision log. */
function setUp(werk: Werk, ids: string[], deps: [string, string][]) {
  const log = join(werk.dir, '.werk', 'log.jsonl')
  for (const id of ids) {
    appendEvent(log, proposed(id, { title: `Card ${id.toUpperCase()}` }), 'agent')
    appendEvent(log, accepted(id), 'you')
    appendEvent(log, whoSet(id, 'me'), 'agent')
    appendEvent(log, noBasis(id, 'a test card'), 'agent')
    appendEvent(log, killed(id), 'agent')
    appendEvent(log, statusSet(id, 'decided'), 'agent')
  }
  for (const [from, to] of deps) appendEvent(log, linked(from, to, 'depends_on'), 'agent')
}

const tile = (page: import('@playwright/test').Page, id: string) => page.locator(`li[data-card-id="${id}"] > a`)

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  setUp(werk, ['a', 'b', 'c'], [['b', 'a'], ['c', 'b']])
  werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The API is gone.'])
  await page.goto(werk.url)
  const b = tile(page, 'b')
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  await expect(b).toHaveAttribute('data-status', 'decided')
  await expect(b).toHaveCSS('border-left-color', GREEN)
  const c = tile(page, 'c')
  await expect(c).toBeVisible()
  await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  await expect(c.locator('.mark[data-mark="paused"]')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  setUp(werk, ['a', 'b', 'c'], [['b', 'a'], ['c', 'b']])
  werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'Later.'])
  await page.goto(werk.url)
  for (const id of ['b', 'c']) {
    await expect(tile(page, id).locator('.mark[data-mark="paused"]')).toHaveCSS('background-color', GREY)
    await expect(tile(page, id).locator('.mark[data-mark="stale"]')).toHaveCount(0)
  }
  await expect(tile(page, 'c')).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, 'c')).toHaveCSS('border-left-color', GREEN)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  setUp(werk, ['a', 'b'], [['b', 'a']])
  werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'b').click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const item = marks.locator('li').first()
  await expect(item).toContainText('#a Card A was reopened')
  await expect(item).toContainText('depends_on')
  await expect(item).toContainText('rejected')
  await expect(item).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  setUp(werk, ['a', 'b', 'c'], [['b', 'a'], ['c', 'b']])
  werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'c').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'c')
  const marks = page.getByRole('region', { name: 'marks' })
  await expect.soft(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const item = marks.locator('li').first()
  await expect(item).toContainText('#a Card A was reopened')
  await expect(item).toContainText('postponed')
  await expect(item).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  setUp(werk, ['a', 'x', 'b'], [['b', 'a'], ['b', 'x']])
  werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'Not now.'])
  werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong.'])
  await page.goto(werk.url)
  const b = tile(page, 'b')
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await b.click()
  const marks = page.getByRole('region', { name: 'marks' })
  const itemA = marks.locator('li[data-cause="a"]')
  await expect(itemA).toContainText('#a Card A was reopened, rejected')
})
