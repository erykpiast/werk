// The map in a real browser, against a real `werk serve` on the fixture log. Every assertion
// is on structure: roles, names, classes, visibility. The PNG each test writes is evidence
// for a human or a subagent to look at, never a verdict — #werk-test-visual-judge.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE = join(import.meta.dirname, 'evidence')
mkdirSync(EVIDENCE, { recursive: true })

const evidence = (page: Page, name: string) => page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true })

/** POSTs to the chat endpoint, recorded so a spec can prove it never sent one. */
let chatPosts: string[] = []

test.beforeEach(async ({ page }) => {
  chatPosts = []
  // No spec talks to an agent. Any send is refused here and fails the test after it.
  await page.route('**/api/chat', async (route) => {
    chatPosts.push(route.request().postData() ?? '')
    await route.abort()
  })
  // The 3D graph loads its library from esm.sh. Kept offline, so a run never depends on it.
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.addInitScript(() => localStorage.clear())
})

test.afterEach(() => {
  expect(chatPosts, 'a spec sent a chat message').toEqual([])
})

const hero = (page: Page) => page.locator('#hero')
/** The home's two columns, What then How (#vi-home-howwhat). */
const homeColumns = (page: Page) => page.locator('#sections .home .home-col')
const expectHome = async (page: Page) => {
  await expect(homeColumns(page).locator('.home-top h2')).toHaveText(['Fixture map', 'Fixture build rules'])
}

test('the home shows the requirements and the build rules side by side, each with its children', async ({ page }) => {
  await page.goto('/')
  await expectHome(page)
  await expect(page.locator('#crumbs')).toHaveText('Home')
  await expect(page).toHaveTitle('Home — werk')
  const [what, how] = [homeColumns(page).nth(0), homeColumns(page).nth(1)]
  await expect(what.locator('.home-label b')).toHaveText('What')
  await expect(how.locator('.home-label b')).toHaveText('How')
  await expect(what.locator('button.card')).toHaveCount(3)
  await expect(how.locator('button.card[data-go="real-db"]')).toBeVisible()
  // Side by side on a wide pane: the How column starts level with the What column.
  const [a, b] = [await what.boundingBox(), await how.boundingBox()]
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1)
  expect(Math.abs(b!.y - a!.y)).toBeLessThan(2)
  await evidence(page, 'home')

  // A top card opens its own view, and its breadcrumbs lead back to the home.
  await how.locator('.home-top').click()
  await expect(page).toHaveURL(/\/map\/how$/)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Fixture build rules')
  await expect(hero(page).locator('[data-remove]')).toHaveCount(0)
  await page.locator('#crumbs .crumb[data-go="~home"]').first().click()
  await expect(page).toHaveURL(/\/map$/)
  await expectHome(page)
})

test('the root card shows its title, its body and its children', async ({ page }) => {
  await page.goto('/map/what')
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Fixture map')
  await expect(hero(page).locator('.body')).toContainText('The root of the fixture.')
  const below = page.locator('#sections section').filter({ hasText: '3 below' })
  await expect(below.getByRole('button')).toHaveCount(3)
  for (const title of ['Upstream decision', 'Downstream card', 'Sibling card']) {
    await expect(below.getByRole('button', { name: new RegExp(title) })).toBeVisible()
  }
  await expect(page.locator('#sections')).toContainText('a note on the root card')
  await evidence(page, 'what')
})

test('a card opened by an old hash address shows its own detail', async ({ page }) => {
  await page.goto('/#sibling')
  await expect(page).toHaveURL(/\/map\/sibling$/)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Sibling card')
  await expect(hero(page).locator('.why')).toHaveText('Open, and depends on nothing.')
  await expect(hero(page).locator('.body strong')).toHaveText('bold')
  await expect(page).toHaveTitle('Sibling card — werk')
  await evidence(page, 'sibling')
})

test('the stale mark sits on the dependent, not on the reopened card', async ({ page }) => {
  await page.goto('/')
  const card = (id: string) => page.locator(`#sections button.card[data-go="${id}"]`)
  await expect(card('downstream')).toHaveClass(/is-stale/)
  await expect(card('upstream')).not.toHaveClass(/is-stale/)
  await expect(card('sibling')).not.toHaveClass(/is-stale/)
  // The stale count lives in the Flow tab, not on the home card (#vi-flowtab-home).
  await page.goto('/flow')
  await expect(page.locator('.flow-tile[data-filter="stale"] .v')).toHaveText('1')

  await page.goto('/#downstream')
  // The STALE chip says it. A stale card has no alarm of its own.
  await expect(hero(page).locator('.tag.stale')).toHaveText('stale')
  await expect(page.locator('#alarms')).toBeEmpty()
  await evidence(page, 'stale-downstream')

  await page.goto('/#upstream')
  await expect(hero(page).locator('.tag.stale')).toHaveCount(0)
  await expect(hero(page).locator('.tag.open')).toHaveText('open')
})

test('a #card-id link in a body navigates to that card', async ({ page }) => {
  await page.goto('/#downstream')
  const link = hero(page).locator('.body').getByRole('link', { name: '#upstream' })
  // #vi-routes: a card link stays in the current project.
  await expect(link).toHaveAttribute('href', /^\/p\/[^/]+\/map\/upstream$/)
  await link.click()
  await expect(page).toHaveURL(/\/map\/upstream$/)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Upstream decision')
  // Its rejected option is listed with it.
  await expect(page.locator('#sections section').filter({ hasText: 'Options' })).toContainText('Store a snapshot instead')
  await evidence(page, 'link-to-upstream')
})

test('the view switch moves between map, graph and diagram', async ({ page }) => {
  await page.goto('/')
  const toggle = page.locator('#view-toggle')
  const views = { map: page.locator('#map-view'), graph: page.locator('#graph-view'), diagram: page.locator('#diagram-view') }
  const only = async (shown: keyof typeof views) => {
    for (const [name, view] of Object.entries(views)) {
      if (name === shown) await expect(view).toBeVisible()
      else await expect(view).toBeHidden()
    }
    await expect(toggle.locator('button.active')).toHaveAttribute('data-view', shown)
  }

  await only('map')
  await toggle.getByRole('button', { name: 'Graph' }).click()
  await only('graph')
  await evidence(page, 'view-graph')

  await toggle.getByRole('button', { name: 'Diagram' }).click()
  await only('diagram')
  await expect(page.locator('#diagram-svg-inline svg')).toHaveCount(1)
  await expect(page.locator('#diagram-svg-inline svg')).toContainText('map view')
  await evidence(page, 'view-diagram')

  await toggle.getByRole('button', { name: 'Map' }).click()
  await only('map')
  await expectHome(page)
})

test('removed cards are listed only under the removed filter in Flow, never on the root page (#vi-flowtab-removed)', async ({ page }) => {
  // The server is shared, so the removal is added to the graph the page reads, not to the log.
  await page.route('**/api/graph', async (route) => {
    const res = await route.fetch()
    const data = await res.json()
    data.removed = [{ id: 'gone-card', title: 'A card taken out', at: '2026-10-02T10:00:00.000Z' }]
    await route.fulfill({ response: res, json: data })
  })
  await page.goto('/map')
  await expectHome(page)
  await expect(page.locator('#sections')).not.toContainText('A card taken out')

  await page.goto('/flow')
  const removed = page.locator('.flow-filters button[data-filter="removed"]')
  await expect(removed.locator('small')).toHaveText('1')
  await expect(page.locator('#flow-list')).not.toContainText('A card taken out')
  await removed.click()
  const row = page.locator('#flow-list tr.removed-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('#gone-card')
  await expect(row).toContainText('2026-10-02')
  await expect(row.getByRole('button', { name: 'restore' })).toBeVisible()
  await evidence(page, 'flow-removed')
})

test('the ✕ on a card with children asks whether they go too or move up (#vi-remove-btn-reparent)', async ({ page }) => {
  // The server is shared, so the child is added to the graph the page reads, and the removal
  // request is caught before it reaches the log.
  await page.route('**/api/graph', async (route) => {
    const res = await route.fetch()
    const data = await res.json()
    data.nodes.push({ id: 'kid', kind: 'card', title: 'A good child', status: 'open' })
    data.edges.push({ from: 'kid', to: 'sibling', type: 'refines' })
    data.rollup.sibling = { ...(data.rollup.sibling ?? {}), cards: 2 }
    await route.fulfill({ response: res, json: data })
  })
  const removals: unknown[] = []
  await page.route('**/api/node/remove', async (route) => {
    removals.push(route.request().postDataJSON())
    await route.fulfill({ json: { ok: true, removed: ['sibling'] } })
  })
  await page.goto('/map/sibling')
  await hero(page).locator('.remove-btn').click()
  const dlg = page.locator('dialog.remove-dlg')
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('.rd-all')).toContainText('the 1 card(s) below it')
  await expect(dlg.locator('.rd-up')).toContainText('1 child card(s) move up to Fixture map')
  await evidence(page, 'remove-reparent-dialog')

  await dlg.locator('.rd-cancel').click()
  await expect(dlg).toHaveCount(0)
  expect(removals).toEqual([])

  await hero(page).locator('.remove-btn').click()
  await page.locator('dialog.remove-dlg .rd-up').click()
  await expect.poll(() => removals).toEqual([{ id: 'sibling', reparent: true }])
})

test('an option id is a valid encoded address, and a card not in the map gets a page that says so (#vi-routes)', async ({ page }) => {
  await page.goto(`/map/${encodeURIComponent('upstream:opt0')}`)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Store a snapshot instead')

  await page.goto('/map/no-such-card')
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('No node "no-such-card"')
  await page.goto('/map/%')
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('No node "%"')
  await evidence(page, 'route-missing-card')
})

test('each view has its own address, and Back and Forward walk them', async ({ page }) => {
  await page.goto('/map/sibling')
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Sibling card')

  await page.locator('#view-toggle').getByRole('button', { name: 'Flow' }).click()
  await expect(page).toHaveURL(/\/flow$/)
  await expect(page.locator('#flow-view')).toBeVisible()

  // The row outside the name goes one level deeper, and that is one history entry.
  await page.locator('#flow tr[data-scope="upstream"] td.num').first().click()
  await expect(page).toHaveURL(/\/flow\/upstream$/)
  await expect(page.locator('.flow-scope')).toContainText('Upstream decision')

  await page.goBack()
  await expect(page).toHaveURL(/\/flow$/)
  await expect(page.locator('.flow-scope b')).toHaveText('Whole map')

  await page.goBack()
  await expect(page).toHaveURL(/\/map\/sibling$/)
  await expect(page.locator('#map-view')).toBeVisible()
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Sibling card')

  await page.goForward()
  await page.goForward()
  await expect(page).toHaveURL(/\/flow\/upstream$/)
  await expect(page.locator('.flow-scope')).toContainText('Upstream decision')

  // A reload keeps the view and the scope: the server answers the address with the app.
  await page.reload()
  await expect(page.locator('#flow-view')).toBeVisible()
  await expect(page.locator('.flow-scope')).toContainText('Upstream decision')

  // The id in a row opens the card on the map.
  await page.locator('#flow-list .flow-id[data-open="upstream"]').click()
  await expect(page).toHaveURL(/\/map\/upstream$/)
  await expect(hero(page).getByRole('heading', { level: 1 })).toHaveText('Upstream decision')
  await evidence(page, 'routes-back-to-map')
})

test('a # search matches ids only, exact id first, and each row shows a dot and the id', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('#results button')
  const ids = () => rows.locator('small').allTextContents()

  // Without the #, the word "upstream" in the downstream card's why matches too.
  await page.fill('#jump', 'upstream')
  expect(await ids()).toContain('downstream')

  // With the #, only ids match: the exact id first, then the id that starts with it.
  await page.fill('#jump', '#upstream')
  expect(await ids()).toEqual(['upstream', 'upstream:opt0'])
  await expect(rows.nth(0).locator('.dot')).toHaveClass(/\bopen\b/)
  await expect(rows.nth(1).locator('.dot')).toHaveClass(/\boption\b/)

  // An id that only contains the query still matches; the stale card's dot is red.
  await page.fill('#jump', '#downstr')
  await expect(rows.nth(0).locator('.dot')).toHaveClass(/\bstale\b/)
  await evidence(page, 'jump-hash')

  await page.fill('#jump', '#nothing-like-this')
  await expect(page.locator('#results')).toBeHidden()

  await page.fill('#jump', '#upstream')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/map\/upstream$/)
})
