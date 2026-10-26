/** Held-out steps 72.1–72.5: stale and paused marks in the browser. */
import { expect, test } from '../../e2e/harness.ts'
import type { Werk } from '../../e2e/harness.ts'
import { card, dependsOn, realCard, seed } from './helpers.ts'

const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const decided = { status: 'decided' }

/** A <- B <- C, all in the given statuses. */
function chain(werk: Werk, statuses: { a?: string; b?: string; c?: string } = {}) {
  const s = (v?: string) => (v ? { status: v } : {})
  seed(werk, [
    ...realCard('card-a', 'Card A', s(statuses.a)),
    ...realCard('card-b', 'Card B', s(statuses.b)),
    ...realCard('card-c', 'Card C', s(statuses.c)),
    dependsOn('card-b', 'card-a'),
    dependsOn('card-c', 'card-b'),
  ])
}

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  chain(werk, { a: 'decided', b: 'decided', c: 'decided' })
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  const b = page.locator(`${card('card-b')} > a`)
  const c = page.locator(`${card('card-c')} > a`)
  await expect(b.locator('.mark')).toHaveText('stale')
  await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
  await expect(b).toHaveAttribute('data-status', 'decided')
  const decidedColour = await c.evaluate((a) => getComputedStyle(a).borderLeftColor)
  await expect(b).toHaveCSS('border-left-color', 'rgb(46, 125, 50)')
  expect(decidedColour).toBe('rgb(46, 125, 50)')
  await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  await expect(c.locator('.mark[data-mark="paused"]')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  chain(werk, { a: 'decided', b: 'decided', c: 'decided' })
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(werk.url)
  const b = page.locator(`${card('card-b')} > a`)
  const c = page.locator(`${card('card-c')} > a`)
  await expect(b.locator('.mark')).toHaveText('paused')
  await expect(b.locator('.mark')).toHaveCSS('background-color', GREY)
  await expect(c.locator('.mark')).toHaveText('paused')
  await expect(c.locator('.mark')).toHaveCSS('background-color', GREY)
  await expect(c).toHaveAttribute('data-status', 'decided')
  await expect(c).toHaveCSS('border-left-color', 'rgb(46, 125, 50)')
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  seed(werk, [...realCard('card-a', 'Card A', decided), ...realCard('card-b', 'Card B', decided), dependsOn('card-b', 'card-a')])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await page.locator(`${card('card-b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li').first()
  await expect(trace).toContainText('#card-a')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk, { a: 'decided', b: 'decided', c: 'decided' })
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await page.locator(`${card('card-c')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  // The step names the heading "Why this card is stale" for a paused card.
  await expect.soft(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  await expect(marks).toContainText('#card-a')
  await expect(marks).toContainText('reopened')
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  seed(werk, [
    ...realCard('card-a', 'Card A', decided),
    ...realCard('card-x', 'Card X', decided),
    ...realCard('card-b', 'Card B', decided),
    dependsOn('card-b', 'card-a'),
    dependsOn('card-b', 'card-x'),
  ])
  werk.cli(['reopen', 'card-x', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(werk.url)
  const b = page.locator(`${card('card-b')} > a`)
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await b.click()
  const trace = page.getByRole('region', { name: 'marks' }).locator('li[data-cause="card-a"]')
  await expect(trace).toHaveAttribute('data-reason', 'rejected')
  await expect(trace).toContainText('rejected')
})
