import { expect, test, type Werk } from '../e2e/harness.ts'

const card = (id: string) => `li[data-card-id="${id}"]`
const RED = 'rgb(179, 38, 30)'
const GREY = 'rgb(117, 117, 117)'
const GREEN = 'rgb(46, 125, 50)'

/** A decided real card under the decided root card "werk", that depends on each of `deps`. */
function decided(werk: Werk, id: string, title: string, deps: string[] = []) {
  werk.cli(['add', id, '--title', title, '--parent', 'werk', '--who', 'me'])
  for (const d of deps) werk.cli(['link', id, d, '--type', 'depends_on'])
  werk.cli(['kill', id, '--form', 'revisit'])
  werk.cli(['status', id, 'decided'])
  werk.cli(['accept', id, '--actor', 'you'])
}

function chain(werk: Werk) {
  decided(werk, 'card-a', 'Card A')
  decided(werk, 'card-b', 'Card B', ['card-a'])
  decided(werk, 'card-c', 'Card C', ['card-b'])
}

test('72.1 a rejected reopen marks only the direct dependent stale, in red', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  await page.goto(werk.url)
  const b = page.locator(`${card('card-b')} > a`)
  await expect(b.locator('.mark')).toHaveText('stale')
  await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
  await expect(b).toHaveAttribute('data-status', 'decided')
  await expect(b).toHaveCSS('border-left-color', GREEN)
  const c = page.locator(`${card('card-c')} > a`)
  await expect(c).toBeVisible()
  await expect(c.locator('.mark')).toHaveCount(0)
})

test('72.2 a postponed reopen marks every downstream card paused, grey, and keeps the status colour', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'Not this quarter'])
  await page.goto(werk.url)
  for (const id of ['card-b', 'card-c']) {
    const m = page.locator(`${card(id)} > a .mark`)
    await expect(m).toHaveText('paused')
    await expect(m).toHaveCSS('background-color', GREY)
    await expect(page.locator(`${card(id)} > a .mark[data-mark="stale"]`)).toHaveCount(0)
  }
  const c = page.locator(`${card('card-c')} > a`)
  await expect(c).toHaveAttribute('data-status', 'decided')
  await expect(c).toHaveCSS('border-left-color', GREEN)
})

test('72.3 the card view of a stale card explains the change, the link and the reason', async ({ page, werk }) => {
  decided(werk, 'card-a', 'Card A')
  decided(werk, 'card-b', 'Card B', ['card-a'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  await page.goto(werk.url)
  await page.locator(`${card('card-b')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  await expect(marks.getByRole('heading')).toContainText('Why this card is stale')
  const trace = marks.locator('li[data-cause="card-a"]')
  await expect(trace).toContainText('#card-a')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('depends_on')
  await expect(trace).toContainText('rejected')
  await expect(trace).toContainText('The vendor dropped this API')
})

test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  chain(werk)
  werk.cli(['reopen', 'card-a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  await page.goto(werk.url)
  await page.locator(`${card('card-c')} > a`).click()
  const marks = page.getByRole('region', { name: 'marks' })
  const trace = marks.locator('li[data-cause="card-a"]')
  await expect(trace).toContainText('reopened')
  await expect(trace).toContainText('postponed')
  await expect(trace).toContainText('We build the engine next quarter')
  // The step names the heading text exactly.
  await expect(marks.getByRole('heading')).toContainText('Why this card is stale', { timeout: 3000 })
})

test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  decided(werk, 'card-a', 'Card A')
  decided(werk, 'card-x', 'Card X')
  decided(werk, 'card-b', 'Card B', ['card-a', 'card-x'])
  werk.cli(['reopen', 'card-x', '--reason', 'postponed', '--why', 'Later'])
  werk.cli(['reopen', 'card-a', '--reason', 'rejected', '--why', 'Wrong'])
  await page.goto(werk.url)
  const b = page.locator(`${card('card-b')} > a`)
  await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  await b.click()
  const trace = page.getByRole('region', { name: 'marks' }).locator('li[data-cause="card-a"]')
  await expect(trace).toContainText('Card A')
  await expect(trace).toContainText('rejected')
})
