import { expect, test, decidedCard, type Werk } from './harness.ts'

const tile = (id: string) => `li[data-card-id="${id}"] > a`
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const DECIDED = 'rgb(46, 125, 50)'

function chain(werk: Werk) {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-b', 'Card B', undefined, ['card-a'])
  decidedCard(werk, 'card-c', 'Card C', undefined, ['card-b'])
}

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  const b = page.locator(tile('card-b'))
  await expect(b.locator('.mark')).toHaveText('stale')
  await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
  await expect(b).toHaveAttribute('data-status', 'decided')
  await expect(b).toHaveCSS('border-left-color', DECIDED)
  const c = page.locator(tile('card-c'))
  await expect(c).toBeVisible()
  await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  await expect(c.locator('.mark[data-mark="paused"]')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card paused, in grey', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'Later'])
  await page.goto(werk.url)
  for (const id of ['card-b', 'card-c']) {
    const t = page.locator(tile(id))
    await expect(t.locator('.mark')).toHaveText('paused')
    await expect(t.locator('.mark')).toHaveCSS('background-color', GREY)
    await expect(t.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  }
  const c = page.locator(tile('card-c'))
  await expect(c).toHaveAttribute('data-status', 'decided')
  await expect(c).toHaveCSS('border-left-color', DECIDED)
})

test('72.3 the card view of a stale card explains the change, the link and the reason', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-b', 'Card B', undefined, ['card-a'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await page.locator(tile('card-b')).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li').first()
  await expect(trace).toContainText('#card-a')
  await expect(trace).toContainText('was reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await page.locator(tile('card-c')).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  await expect(marks).toContainText('#card-a')
  await expect(marks).toContainText('was reopened')
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decidedCard(werk, 'card-a', 'Card A')
  decidedCard(werk, 'card-x', 'Card X')
  decidedCard(werk, 'card-b', 'Card B', undefined, ['card-a', 'card-x'])
  werk.cli(['reopen', 'card-x', '--reason', 'postponed', '--why', 'Waits'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(werk.url)
  const b = page.locator(tile('card-b'))
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await b.click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks).toContainText('#card-a')
  await expect(marks).toContainText('rejected')
})
