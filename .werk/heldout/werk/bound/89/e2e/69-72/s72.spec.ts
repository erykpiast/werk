import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const DECIDED = 'rgb(46, 125, 50)'

/** A real, decided card under the fixture's root, with the given depends_on targets. */
function decided(werk: Werk, id: string, title: string, dependsOn: string[] = []) {
  werk.cli(['add', id, '--title', title, '--parent', 'werk', '--who', 'me'])
  werk.cli(['accept', id, '--actor', 'you'])
  for (const t of dependsOn) werk.cli(['link', id, t, '--type', 'depends_on', '--why', `${id} needs ${t}`])
  werk.cli(['kill', id, '--form', 'manual', '--text', `revisit ${id} when it hurts`])
  werk.cli(['status', id, 'decided'])
}

function chain(werk: Werk) {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cb', 'Card B', ['ca'])
  decided(werk, 'cc', 'Card C', ['cb'])
}

const tile = (page: Page, id: string) => page.locator(`${card(id)} > a`)
const mark = (page: Page, id: string, kind?: string) =>
  page.locator(`${card(id)} > a .mark${kind ? `[data-mark="${kind}"]` : ''}`)

async function expectDecidedColour(page: Page, id: string) {
  await expect(tile(page, id)).toHaveAttribute('data-status', 'decided')
  await expect(tile(page, id)).toHaveCSS('border-left-color', DECIDED)
}

// 72.1
// Scenario: A rejected reopen marks only the direct dependent as stale, in red
// Given a map with card A, card B that depends on A, and card C that depends on B
// And all three cards are decided
// When the person reopens card A from the command line with the reason rejected and a sentence that says why
// And the person opens the map in the browser
// Then card B shows a red stale mark
// And card B still shows the decided status colour under the mark
// But card C shows no stale mark
// And card C shows no paused mark
test('72.1 a rejected reopen marks only the direct dependent stale, in red', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)

  await expect(mark(page, 'cb')).toHaveText('stale')
  await expect(mark(page, 'cb')).toHaveCSS('background-color', RED)
  await expectDecidedColour(page, 'cb')
  await expect(tile(page, 'cc')).toBeVisible()
  await expect(mark(page, 'cc', 'stale')).toHaveCount(0)
  await expect(mark(page, 'cc', 'paused')).toHaveCount(0)
  await expect(mark(page, 'cc')).toHaveCount(0)
})

// 72.2
// Scenario: A postponed reopen marks every downstream card as paused, in grey, and keeps the status colour
// Given a map with card A, card B that depends on A, and card C that depends on B
// And card B is decided and card C is decided
// When the person reopens card A from the command line with the reason postponed and a sentence that says why
// And the person opens the map in the browser
// Then card B shows a grey paused mark
// And card C, two hops away from card A, shows a grey paused mark
// And card C still shows the decided status colour under the grey mark
// And neither card B nor card C shows a red stale mark
test('72.2 a postponed reopen marks every downstream card paused, in grey', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)

  await expect(mark(page, 'cb')).toHaveText('paused')
  await expect(mark(page, 'cb')).toHaveCSS('background-color', GREY)
  await expect(mark(page, 'cc')).toHaveText('paused')
  await expect(mark(page, 'cc')).toHaveCSS('background-color', GREY)
  await expectDecidedColour(page, 'cc')
  await expect(mark(page, 'cb', 'stale')).toHaveCount(0)
  await expect(mark(page, 'cc', 'stale')).toHaveCount(0)
})

// 72.3
// Scenario: The card view of a stale card explains the change, the link, and the reason
// Given a map with card A and card B that depends on A
// And the person reopens card A from the command line with the reason rejected and the sentence "The vendor dropped this API"
// When the person opens the map in the browser
// And the person opens card B
// Then the card view shows the heading "Why this card is stale"
// And under that heading the person sees that card A was reopened
// And the person sees that card B depends on card A
// And the person sees the reason rejected and the sentence "The vendor dropped this API"
test('72.3 the card view of a stale card explains the change, the link and the reason', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cb', 'Card B', ['ca'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await tile(page, 'cb').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'cb')

  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('Card A')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

// 72.4
// Scenario: The card view of a paused card two hops away names the reopened card and the reason
// Given a map with card A, card B that depends on A, and card C that depends on B
// And the person reopens card A from the command line with the reason postponed and the sentence "We build the engine next quarter"
// When the person opens the map in the browser
// And the person opens card C
// Then the card view shows the heading "Why this card is stale"
// And the person sees that card A was reopened
// And the person sees the reason postponed and the sentence "We build the engine next quarter"
test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await tile(page, 'cc').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'cc')

  const marks = page.getByRole('region', { name: 'marks' })
  const trace = marks.locator('li[data-cause="ca"]')
  // Checked before the heading, so a heading failure still records what the rest showed.
  await expect(trace).toContainText('#ca')
  await expect(trace).toContainText('Card A')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
  await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
})

// 72.5
// Scenario: A stale mark wins over a paused mark on the same card
// Given a map with card A, card X, and card B that depends on both card A and card X
// And the person reopens card X from the command line with the reason postponed
// And the person reopens card A from the command line with the reason rejected
// When the person opens the map in the browser
// Then card B shows a red stale mark
// But card B does not show a grey paused mark
// And when the person opens card B, the card view names card A and the reason rejected
test('72.5 a stale mark wins over a paused mark', async ({ page, werk }) => {
  decided(werk, 'ca', 'Card A')
  decided(werk, 'cx', 'Card X')
  decided(werk, 'cb', 'Card B', ['ca', 'cx'])
  werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'Not this quarter'])
  werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)

  await expect(mark(page, 'cb')).toHaveText('stale')
  await expect(mark(page, 'cb')).toHaveCSS('background-color', RED)
  await expect(mark(page, 'cb', 'paused')).toHaveCount(0)

  await tile(page, 'cb').click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'cb')
  const marks = page.getByRole('region', { name: 'marks' })
  const trace = marks.locator('li[data-cause="ca"]')
  await expect(trace).toContainText('Card A')
  await expect(trace).toContainText('rejected')
  await expect(trace).toHaveAttribute('data-reason', 'rejected')
})
