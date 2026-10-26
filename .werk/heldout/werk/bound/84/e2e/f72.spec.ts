/** Feature 72: stale and paused marks in the browser. */
import type { NewEvent } from '../../src/map/events.ts'
import { accepted, killed, linked, noBasis, proposed, statusSet } from '../../src/test/map-events.ts'
import { expect, open, test } from './harness.ts'

const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const DECIDED = 'rgb(46, 125, 50)'
const tile = (id: string) => `li[data-card-id="${id}"] > a`

function card(id: string, on: string[] = []): NewEvent[] {
  const evs: NewEvent[] = [proposed(id, { title: `Card ${id.toUpperCase()}`, who: 'me' }), accepted(id)]
  if (on.length === 0) evs.push(noBasis(id, 'a root card'))
  for (const t of on) evs.push(linked(id, t, 'depends_on', `takes ${t}`))
  evs.push(killed(id), statusSet(id, 'decided'))
  return evs
}

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, proj }) => {
  proj.seed(...card('a'), ...card('b', ['a']), ...card('c', ['b']))
  proj.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await open(page, proj)
  const b = page.locator(tile('b'))
  await expect(b.locator('.mark')).toHaveText('stale')
  await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
  await expect(b).toHaveAttribute('data-status', 'decided')
  await expect(b).toHaveCSS('border-left-color', DECIDED)
  await expect(page.locator(tile('c')).locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, proj }) => {
  proj.seed(...card('a'), ...card('b', ['a']), ...card('c', ['b']))
  proj.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'Not this quarter'])
  await open(page, proj)
  for (const id of ['b', 'c']) {
    const mark = page.locator(tile(id)).locator('.mark')
    await expect(mark).toHaveText('paused')
    await expect(mark).toHaveCSS('background-color', GREY)
    await expect(page.locator(tile(id)).locator('.mark[data-mark="stale"]')).toHaveCount(0)
  }
  await expect(page.locator(tile('c'))).toHaveAttribute('data-status', 'decided')
  await expect(page.locator(tile('c'))).toHaveCSS('border-left-color', DECIDED)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, proj }) => {
  proj.seed(...card('a'), ...card('b', ['a']))
  proj.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await open(page, proj)
  await page.locator(tile('b')).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading')).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="a"]')
  await expect(trace).toContainText('#a')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, proj }) => {
  proj.seed(...card('a'), ...card('b', ['a']), ...card('c', ['b']))
  proj.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await open(page, proj)
  await page.locator(tile('c')).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect.soft(marks.getByRole('heading')).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="a"]')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, proj }) => {
  proj.seed(...card('a'), ...card('x'), ...card('b', ['a', 'x']))
  proj.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'Later'])
  proj.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong'])
  await open(page, proj)
  const b = page.locator(tile('b'))
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await b.click()
  const trace = page.getByRole('region', { name: 'marks' }).locator('li[data-cause="a"]')
  await expect(trace).toContainText('#a')
  await expect(trace).toContainText('rejected')
})
