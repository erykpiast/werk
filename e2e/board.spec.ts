// The ticket board in a real browser, against `werk serve` on the fixture board.jsonl. See
// #vi-board, #werk-board-columns, #werk-board-control. The specs run in order on one server,
// so the ones that write to the board (reorder, archive) come last.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE = join(import.meta.dirname, 'evidence')
mkdirSync(EVIDENCE, { recursive: true })
const evidence = (page: Page, name: string) => page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true })

test.beforeEach(async ({ page }) => {
  await page.route('**/api/chat', (route) => route.abort())
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await page.locator('#view-toggle').getByRole('button', { name: 'Board' }).click()
})

const column = (page: Page, name: string) => page.locator(`.bcol[data-col="${name}"]`)
const card = (page: Page, id: string) => page.locator(`.tcard[data-ticket="${id}"]`)

test('five columns, each ticket in its own, title only plus its counts', async ({ page }) => {
  await expect(page.locator('.bcol h3')).toHaveText([/^blocked/, /^ready/, /^building/, /^merging/, /^done/])
  await expect(column(page, 'ready').locator('.tcard')).toHaveCount(3)
  await expect(column(page, 'blocked').locator('.tcard')).toHaveCount(1)
  // demo/01: three passes, so two retries; the held-out set went red after its merge.
  await expect(card(page, 'demo/01').locator('.tb-retry')).toHaveText('↻2')
  // demo/02: two passes, so one retry. One retry is not "more than once": no badge.
  await expect(card(page, 'demo/02').locator('.tb-retry')).toHaveCount(0)
  await expect(card(page, 'demo/01').locator('.tb-heldout')).toBeVisible()
  // demo/02 is building with a live session: it pulses. demo/05's blocker is done.
  await expect(card(page, 'demo/02').locator('.pulse')).toBeVisible()
  await expect(card(page, 'demo/01').locator('.pulse')).toHaveCount(0)
  await expect(column(page, 'ready').locator('.tc-trigger')).toHaveCount(3)
  await expect(page.locator('.run-row')).toContainText('G2 waits for you')
  await evidence(page, 'board-columns')
})

test('a click opens the drawer: the slice left, the relations right', async ({ page }) => {
  await card(page, 'demo/01').click()
  const drawer = page.locator('#ticket-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('.td-slice')).toContainText('The board lists every ticket in its column.')
  await expect(drawer.locator('.td-side')).toContainText('2 retries')
  await expect(drawer.locator('.td-side')).toContainText('held-out red')
  await expect(drawer.locator('.td-log')).toHaveCount(0)
  // The held-out badge links to the follow-up ticket.
  await drawer.locator('.td-side .td-tref', { hasText: 'demo/06' }).click()
  await expect(drawer.locator('.td-head h2')).toHaveText('Fix the held-out step')
  await expect(drawer.locator('.td-side')).toContainText('Follow-up of')
})

test('a building ticket shows its live log above the slice', async ({ page }) => {
  await card(page, 'demo/02').click()
  const log = page.locator('#ticket-drawer .td-log')
  await expect(log).toContainText('Reading the ticket.')
  await expect(log).toContainText('▸ Bash make test')
  await evidence(page, 'board-drawer-live')
})

test('a build that refused its ticket sent it back to ready, and the drawer says why', async ({ page }) => {
  await expect(column(page, 'ready').locator('.tcard[data-ticket="demo/03"]')).toBeVisible()
  await card(page, 'demo/03').click()
  await expect(page.locator('#ticket-drawer .td-side')).toContainText('the build refused: werk: no ticket file at')
})

test('a cited card opens on the map', async ({ page }) => {
  await card(page, 'demo/02').click()
  await page.locator('#ticket-drawer .td-side a.ref', { hasText: '#upstream' }).click()
  await expect(page.locator('#map-view')).toBeVisible()
  await expect(page.locator('#hero h1')).toHaveText('Upstream decision')
})

test('an open ticket shows the cards its builds proposed, or that they proposed none (#vi-board-ticket-decisions-2)', async ({ page }) => {
  // The server is shared, so the obligations are added to the graph the page reads.
  await page.route('**/api/graph', async (route) => {
    const res = await route.fetch()
    const data = await res.json()
    data.nodes.push({ id: 'built', kind: 'card', title: 'A card a build proposed', status: 'open', proposed: true })
    data.obligations = [
      { id: 'build-a', ticket: 'demo/01', at: '2026-10-01T10:00:00.000Z', cites: [], cards: ['built'] },
      { id: 'build-b', ticket: 'demo/01', at: '2026-10-01T11:00:00.000Z', cites: [], cards: ['sibling'] },
      { id: 'build-c', ticket: 'demo/02', at: '2026-10-01T12:00:00.000Z', cites: [], cards: [], followed: ['upstream'] },
      { id: 'build-d', ticket: 'demo/03', at: '2026-10-01T13:00:00.000Z', cites: [], cards: [] },
    ]
    await route.fulfill({ response: res, json: data })
  })
  await page.reload()
  const decisions = page.locator('#ticket-drawer .td-sec').filter({ has: page.locator('h4', { hasText: 'Decisions' }) })
  await card(page, 'demo/01').click()
  await expect(decisions.locator('li')).toHaveText(['#built proposal', '#sibling accepted'])
  await card(page, 'demo/02').click()
  await expect(decisions).toContainText('No new card. Followed #upstream.')
  await card(page, 'demo/03').click()
  await expect(decisions.locator('p')).toHaveText('No new card.')
  // No build of demo/04 started: no section. And no card in the map shows an obligation.
  await card(page, 'demo/04').click()
  await expect(page.locator('#ticket-drawer .td-head h2')).toBeVisible()
  await expect(decisions).toHaveCount(0)
  await page.goto('/map/sibling')
  await expect(page.locator('#alarms')).not.toContainText('obligation')
  await expect(page.locator('#alarms')).not.toContainText('owes the map')
})

test('no archive on a done ticket; archive asks first and says nothing is deleted', async ({ page }) => {
  await card(page, 'demo/01').click()
  await expect(page.locator('#ticket-drawer [data-archive]')).toHaveCount(0)
  await card(page, 'demo/04').click()
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    d.accept()
  })
  await page.locator('#ticket-drawer [data-archive]').click()
  expect(message).toContain('never deleted')
  expect(message).toContain('werk ticket restore demo/04')
  await expect(card(page, 'demo/04')).toHaveCount(0)
})

test('dragging a ready ticket to the top reorders ready', async ({ page }) => {
  const ready = column(page, 'ready').locator('.tcard')
  await expect(ready).toHaveCount(2)
  const before = await ready.evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')))
  const last = before[before.length - 1]!
  await card(page, last).dragTo(ready.first(), { targetPosition: { x: 10, y: 2 } })
  await expect(ready.first()).toHaveAttribute('data-ticket', last)
})

test('a building ticket does not drag back to ready; archiving it ends the build (#werk-board-control)', async ({ page }) => {
  await expect(card(page, 'demo/02').locator('.pulse')).toBeVisible()
  await expect(card(page, 'demo/02')).not.toHaveAttribute('draggable', 'true')
  await card(page, 'demo/02').click()
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    d.accept()
  })
  await page.locator('#ticket-drawer [data-archive]').click()
  expect(message).toContain('This ends its build. The build branch stays.')
  await expect(card(page, 'demo/02')).toHaveCount(0)
  await expect(column(page, 'ready').locator('.tcard[data-ticket="demo/02"]')).toHaveCount(0)
})
