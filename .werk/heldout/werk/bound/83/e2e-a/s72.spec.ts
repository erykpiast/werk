import { decidedCard, expect, lnk, seedLog, test } from './harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const GREEN = 'rgb(46, 125, 50)'
const abc = seedLog([
  ...decidedCard('a', 'Card A'),
  ...decidedCard('b', 'Card B'),
  lnk('b', 'a', 'depends_on'),
  ...decidedCard('c', 'Card C'),
  lnk('c', 'b', 'depends_on'),
])

test.describe('72.1', () => {
  test.use({ seed: abc })
  test('72.1 a rejected reopen marks only the direct dependent red', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
    await page.goto(werk.url)
    const b = page.locator(`${card('b')} > a`)
    await expect(b.locator('.mark')).toHaveText('stale')
    await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
    await expect(b).toHaveAttribute('data-status', 'decided')
    await expect(b).toHaveCSS('border-left-color', GREEN)
    const c = page.locator(`${card('c')} > a`)
    await expect(c).toBeVisible()
    await expect(c.locator('.mark')).toHaveCount(0)
  })
})

test.describe('72.2', () => {
  test.use({ seed: abc })
  test('72.2 a postponed reopen pauses every downstream card in grey', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'Waits for next quarter'])
    await page.goto(werk.url)
    for (const id of ['b', 'c']) {
      const mark = page.locator(`${card(id)} > a .mark`)
      await expect(mark).toHaveText('paused')
      await expect(mark).toHaveCSS('background-color', GREY)
      await expect(page.locator(`${card(id)} > a .mark[data-mark="stale"]`)).toHaveCount(0)
    }
    const c = page.locator(`${card('c')} > a`)
    await expect(c).toHaveAttribute('data-status', 'decided')
    await expect(c).toHaveCSS('border-left-color', GREEN)
  })
})

test.describe('72.3', () => {
  test.use({ seed: seedLog([...decidedCard('a', 'Card A'), ...decidedCard('b', 'Card B'), lnk('b', 'a', 'depends_on')]) })
  test('72.3 the card view of a stale card explains the change', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
    await page.goto(werk.url)
    await page.locator(`${card('b')} > a`).click()
    const marks = page.getByRole('region', { name: 'marks' })
    await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
    await expect(marks).toContainText('#a Card A')
    await expect(marks).toContainText('was reopened')
    await expect(marks).toContainText('along depends_on')
    await expect(marks).toContainText('rejected')
    await expect(marks).toContainText('The vendor dropped this API')
  })
})

test.describe('72.4', () => {
  test.use({ seed: abc })
  test('72.4 the card view of a paused card two hops away', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
    await page.goto(werk.url)
    await page.locator(`${card('c')} > a`).click()
    const marks = page.getByRole('region', { name: 'marks' })
    // Checked separately so the later checks still report.
    const heading = await marks.getByRole('heading', { level: 2 }).textContent()
    console.log(`72.4 heading: ${heading}`)
    await expect(marks).toContainText('#a Card A')
    await expect(marks).toContainText('was reopened')
    await expect(marks).toContainText('postponed')
    await expect(marks).toContainText('We build the engine next quarter')
    await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  })
})

test.describe('72.5', () => {
  test.use({
    seed: seedLog([
      ...decidedCard('a', 'Card A'),
      ...decidedCard('x', 'Card X'),
      ...decidedCard('b', 'Card B'),
      lnk('b', 'a', 'depends_on'),
      lnk('b', 'x', 'depends_on'),
    ]),
  })
  test('72.5 stale wins over paused', async ({ page, werk }) => {
    werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'X waits'])
    werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'A is wrong'])
    await page.goto(werk.url)
    const b = page.locator(`${card('b')} > a`)
    await expect(b.locator('.mark')).toHaveCount(1)
    await expect(b.locator('.mark')).toHaveText('stale')
    await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
    await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
    await b.click()
    const marks = page.getByRole('region', { name: 'marks' })
    const trace = marks.locator('li[data-cause="a"]')
    await expect(trace).toHaveAttribute('data-reason', 'rejected')
    await expect(trace).toContainText('#a Card A')
    await expect(trace).toContainText('rejected')
  })
})
