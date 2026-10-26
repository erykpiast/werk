import { card, dep, expect, real, test } from './harness.ts'

const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const decided = { status: 'decided', who: 'me' }
const abc = [
  ...real('a', 'Card A', decided),
  ...real('b', 'Card B', decided),
  ...real('c', 'Card C', decided),
  dep('b', 'a'),
  dep('c', 'b'),
]

test.describe('72.1', () => {
  test.use({ log: { events: abc } })
  test('72.1 rejected reopen marks only the direct dependent, red', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
    await page.goto(werk.url)
    const b = page.locator(`${card('b')} > a`)
    const c = page.locator(`${card('c')} > a`)
    await expect(b.locator('.mark')).toHaveText('stale')
    await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
    await expect(b).toHaveAttribute('data-status', 'decided')
    const decidedColour = await c.evaluate((a) => getComputedStyle(a).borderLeftColor)
    await expect(b).toHaveCSS('border-left-color', decidedColour)
    expect(decidedColour).not.toBe('rgba(0, 0, 0, 0)')
    await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
    await expect(c.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  })
})

test.describe('72.2', () => {
  test.use({ log: { events: [...abc, ...real('ref', 'A decided card with no link', decided)] } })
  test('72.2 postponed reopen pauses every downstream card, grey', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'Next quarter'])
    await page.goto(werk.url)
    const b = page.locator(`${card('b')} > a`)
    const c = page.locator(`${card('c')} > a`)
    await expect(b.locator('.mark')).toHaveText('paused')
    await expect(b.locator('.mark')).toHaveCSS('background-color', GREY)
    await expect(c.locator('.mark')).toHaveText('paused')
    await expect(c.locator('.mark')).toHaveCSS('background-color', GREY)
    await expect(c).toHaveAttribute('data-status', 'decided')
    const decidedColour = await page.locator(`${card('ref')} > a`).evaluate((a) => getComputedStyle(a).borderLeftColor)
    await expect(c).toHaveCSS('border-left-color', decidedColour)
    await expect(b.locator('.mark[data-mark="stale"]')).toHaveCount(0)
    await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  })
})

test.describe('72.3', () => {
  test.use({ log: { events: [...real('a', 'Card A', decided), ...real('b', 'Card B', decided), dep('b', 'a')] } })
  test('72.3 the card view of a stale card explains', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
    await page.goto(werk.url)
    await page.locator(`${card('b')} > a`).click()
    const marks = page.getByRole('region', { name: 'marks' })
    await expect(marks.getByRole('heading')).toContainText('Why this card is stale')
    const trace = marks.locator('li').first()
    await expect(trace).toContainText('#a Card A')
    await expect(trace).toContainText('reopened')
    await expect(trace).toContainText('depends_on')
    await expect(trace).toContainText('rejected')
    await expect(trace).toContainText('The vendor dropped this API')
  })
})

test.describe('72.4', () => {
  test.use({ log: { events: abc } })
  test('72.4 the card view of a paused card two hops away', async ({ page, werk }) => {
    werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
    await page.goto(werk.url)
    await page.locator(`${card('c')} > a`).click()
    await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'c')
    const marks = page.getByRole('region', { name: 'marks' })
    await expect(marks).toContainText('#a Card A')
    await expect(marks).toContainText('reopened')
    await expect(marks).toContainText('postponed')
    await expect(marks).toContainText('We build the engine next quarter')
    await expect(marks.getByRole('heading')).toContainText('Why this card is stale')
  })
})

test.describe('72.5', () => {
  test.use({
    log: { events: [...real('a', 'Card A', decided), ...real('x', 'Card X', decided), ...real('b', 'Card B', decided), dep('b', 'a'), dep('b', 'x')] },
  })
  test('72.5 stale wins over paused', async ({ page, werk }) => {
    werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'Later'])
    werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong'])
    await page.goto(werk.url)
    const b = page.locator(`${card('b')} > a`)
    await expect(b.locator('.mark[data-mark="stale"]')).toHaveCount(1)
    await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
    await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
    await b.click()
    const marks = page.getByRole('region', { name: 'marks' })
    const trace = marks.locator('li[data-cause="a"]')
    await expect(trace).toContainText('#a Card A')
    await expect(trace).toContainText('rejected')
  })
})
