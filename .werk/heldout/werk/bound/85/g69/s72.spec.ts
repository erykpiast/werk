import { test, expect } from '@playwright/test'
import { project, card, link, type Proj, type Server } from './werk.ts'

const li = (id: string) => `li[data-card-id="${id}"]`
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const GREEN = 'rgb(46, 125, 50)'
let p: Proj
let s: Server | undefined
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('evidence.png'), fullPage: true }).catch(() => {})
  await s?.stop()
  s = undefined
  p?.cleanup()
})
const dec = (id: string, title: string) => card(id, title, { status: 'decided', who: 'me' })
const chain = () => [...dec('a', 'Card A'), ...dec('b', 'Card B'), ...dec('c', 'Card C'), ...link('b', 'a', 'depends_on'), ...link('c', 'b', 'depends_on')]
const reopen = (id: string, reason: string, why: string) => {
  const r = p.cli(['reopen', id, '--reason', reason, '--why', why])
  expect(r.code, r.stderr).toBe(0)
}
const markOf = (page: import('@playwright/test').Page, id: string) => page.locator(`${li(id)} > a .mark`)

test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page }) => {
  p = project(chain())
  reopen('a', 'rejected', 'The storage choice is wrong')
  s = await p.serve()
  await page.goto(s.url)
  const mb = markOf(page, 'b')
  await expect(mb).toHaveText('stale')
  await expect(mb).toHaveCSS('background-color', RED)
  const tb = page.locator(`${li('b')} > a`)
  await expect(tb).toHaveAttribute('data-status', 'decided')
  await expect(tb).toHaveCSS('border-left-color', GREEN)
  await expect(page.locator(`${li('c')} > a`)).toBeVisible()
  await expect(markOf(page, 'c')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page }) => {
  p = project(chain())
  reopen('a', 'postponed', 'The engine build waits for next quarter')
  s = await p.serve()
  await page.goto(s.url)
  for (const id of ['b', 'c']) {
    await expect(markOf(page, id)).toHaveText('paused')
    await expect(markOf(page, id)).toHaveCSS('background-color', GREY)
  }
  const tc = page.locator(`${li('c')} > a`)
  await expect(tc).toHaveAttribute('data-status', 'decided')
  await expect(tc).toHaveCSS('border-left-color', GREEN)
  await expect(page.locator(`${li('b')} > a .mark[data-mark="stale"], ${li('c')} > a .mark[data-mark="stale"]`)).toHaveCount(0)
})

test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page }) => {
  p = project([...dec('a', 'Card A'), ...dec('b', 'Card B'), ...link('b', 'a', 'depends_on')])
  reopen('a', 'rejected', 'The vendor dropped this API')
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible()
  await expect(marks).toContainText('#a')
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText('reopened')
  await expect(marks).toContainText('depends_on')
  await expect(marks).toContainText('rejected')
  await expect(marks).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page }) => {
  p = project(chain())
  reopen('a', 'postponed', 'We build the engine next quarter')
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('c')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  // The step text names the heading "Why this card is stale" for a paused card too.
  await expect.soft(page.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible({ timeout: 3000 })
  await expect(marks).toContainText('Card A')
  await expect(marks).toContainText('reopened')
  await expect(marks).toContainText('postponed')
  await expect(marks).toContainText('We build the engine next quarter')
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page }) => {
  p = project([...dec('a', 'Card A'), ...dec('x', 'Card X'), ...dec('b', 'Card B'), ...link('b', 'a', 'depends_on'), ...link('b', 'x', 'depends_on')])
  reopen('x', 'postponed', 'Later')
  reopen('a', 'rejected', 'Wrong')
  s = await p.serve()
  await page.goto(s.url)
  await expect(markOf(page, 'b')).toHaveText('stale')
  await expect(markOf(page, 'b')).toHaveCSS('background-color', RED)
  await expect(page.locator(`${li('b')} > a .mark[data-mark="paused"]`)).toHaveCount(0)
  await page.locator(`${li('b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.locator('li[data-cause="a"]')).toContainText('rejected')
  await expect(marks).toContainText('Card A')
})
