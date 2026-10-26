import { expect, L, real, test, tile, type Page } from './h.ts'

const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const DECIDED = 'rgb(46, 125, 50)'
const d = (id: string, title: string) => real(id, { title, status: 'decided', who: 'me' })
const chain = () => [...d('a', 'Card A'), ...d('b', 'Card B'), ...d('c', 'Card C'), L('b', 'a', 'depends_on'), L('c', 'b', 'depends_on')]
const mark = (page: Page, id: string) => page.locator(`${tile(id)} > a .mark`)

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, boot }) => {
  const p = await boot(chain())
  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(p.url)
  await expect(page.locator(tile('c'))).toBeVisible()
  await expect(mark(page, 'b')).toHaveText('stale')
  await expect(mark(page, 'b')).toHaveCSS('background-color', RED)
  await expect(page.locator(`${tile('b')} > a`)).toHaveAttribute('data-status', 'decided')
  await expect(page.locator(`${tile('b')} > a`)).toHaveCSS('border-left-color', DECIDED)
  await expect(mark(page, 'c')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, boot }) => {
  const p = await boot(chain())
  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(p.url)
  await expect(page.locator(tile('c'))).toBeVisible()
  await expect(mark(page, 'b')).toHaveText('paused')
  await expect(mark(page, 'b')).toHaveCSS('background-color', GREY)
  await expect(mark(page, 'c')).toHaveText('paused')
  await expect(mark(page, 'c')).toHaveCSS('background-color', GREY)
  await expect(page.locator(`${tile('c')} > a`)).toHaveAttribute('data-status', 'decided')
  await expect(page.locator(`${tile('c')} > a`)).toHaveCSS('border-left-color', DECIDED)
  await expect(page.locator('.mark[data-mark="stale"]')).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, boot }) => {
  const p = await boot([...d('a', 'Card A'), ...d('b', 'Card B'), L('b', 'a', 'depends_on')])
  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(p.url)
  await page.locator(`${tile('b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  await expect(marks).toContainText('#a')
  await expect(marks).toContainText('reopened')
  await expect(marks).toContainText('depends_on')
  await expect(marks).toContainText('rejected')
  await expect(marks).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, boot }) => {
  const p = await boot(chain())
  p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(p.url)
  await page.locator(`${tile('c')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect.soft(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  await expect(marks.locator('li[data-cause="a"]')).toContainText('reopened')
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, boot }) => {
  const p = await boot([...d('a', 'Card A'), ...d('x', 'Card X'), ...d('b', 'Card B'), L('b', 'a', 'depends_on'), L('b', 'x', 'depends_on')])
  p.ok(['reopen', 'x', '--reason', 'postponed', '--why', 'Later'])
  p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(p.url)
  await expect(page.locator(tile('b'))).toBeVisible()
  await expect(mark(page, 'b')).toHaveText('stale')
  await expect(mark(page, 'b')).toHaveCSS('background-color', RED)
  await expect(page.locator(`${tile('b')} .mark[data-mark="paused"]`)).toHaveCount(0)
  await page.locator(`${tile('b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.locator('li[data-cause="a"]')).toContainText('rejected')
})
