import { expect, test } from '@playwright/test'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, REPO, serve, type Server } from './helpers.ts'
import { planProject, script, spec, SUBTREE, ticket, werk } from './plan-fixture.ts'

const PORT = 5317
const DECISIONS_SPEC = [
  { id: 'shop-store-json', title: 'Items are kept in one JSON file', why: 'No card says where items live.', body: 'One JSON file holds the list.' },
  { id: 'shop-order', title: 'New items go to the top of the list', why: 'No card says the order.', body: 'Newest first.' },
]
const DECISIONS_TICKETS = [{ id: 'shop-dup', title: 'A duplicate item is refused', why: 'No card says what a duplicate does.', body: 'The add is refused.' }]

let server: Server | undefined
test.afterEach(async () => {
  await server?.stop()
  server = undefined
})

test('16.2 every writer decision no card gives comes back as a ghost card under the subtree', async ({ page }) => {
  await page.route('https://esm.sh/**', (route) => route.abort())
  await page.route('**/api/chat', (route) => route.abort())
  const p = planProject(SUBTREE)
  script(p, [
    { match: 'You are the spec writer', files: { '.werk/specs/shop.md': spec(2), '.werk/specs/shop.decisions.json': JSON.stringify(DECISIONS_SPEC) } },
    {
      match: 'You are the ticket writer',
      files: {
        '.werk/tickets/shop/01.md': ticket({ title: 'Store items', cites: 'shop, b, ext', stories: '1' }),
        '.werk/tickets/shop/02.md': ticket({ title: 'Add an item', cites: 'a', blocked: '01', stories: '2' }),
        '.werk/specs/shop.ticket-decisions.json': JSON.stringify(DECISIONS_TICKETS),
      },
    },
  ])
  const r = werk(p, ['plan', 'shop'])
  console.log('16.2 plan stderr:\n' + r.stderr)
  expect(r.code).toBe(0)

  // A plain bin dir for the server: the map's background agents get a do-nothing claude.
  const binDir = join(p.dir, 'servebin')
  mkdirSync(binDir)
  writeFileSync(join(binDir, 'claude'), `#!/bin/sh\nexec bun ${JSON.stringify(join(REPO, 'src', 'test', 'fake-claude.ts'))} "$@"\n`)
  chmodSync(join(binDir, 'claude'), 0o755)
  server = await serve({ dir: p.dir, log: p.log, bin: binDir }, PORT)
  const all = [...DECISIONS_SPEC, ...DECISIONS_TICKETS]

  await page.goto(`${server.url}/map/shop`)
  await expect(page.locator('#hero h1')).toHaveText('Shopping list')
  const below = page.locator('#sections section').filter({ hasText: /below/ })
  await expect(below.locator('h2')).toContainText(`${all.length} proposed`)
  for (const d of all) {
    const card = below.locator(`button.card[data-go="${d.id}"]`)
    await expect(card).toBeVisible()
    await expect(card).toHaveClass(/is-ghost/)
    await expect(card).not.toHaveClass(/\bdecided\b/)
  }
  // Exactly one ghost per decision.
  await expect(below.locator('button.card.is-ghost')).toHaveCount(all.length)
  await page.screenshot({ path: join(HERE, 'test-results', '16.2-subtree.png'), fullPage: true })

  // Each ghost card shows as proposed, not decided.
  for (const d of all) {
    await page.goto(`${server.url}/map/${d.id}`)
    await expect(page.locator('#hero h1')).toHaveText(d.title)
    await expect(page.locator('#hero .tag.ghost')).toHaveText('proposed')
    await expect(page.locator('#hero .tag.decided')).toHaveCount(0)
  }

  // Accept one with ✓.
  const target = all[0]
  await page.goto(`${server.url}/map/${target.id}`)
  await page.locator('#hero button.accept-btn', { hasText: '✓' }).click()
  await expect(page.locator('#hero .tag.ghost')).toHaveCount(0)
  await page.goto(`${server.url}/map/shop`)
  const accepted = page.locator(`#sections button.card[data-go="${target.id}"]`)
  await expect(accepted).toBeVisible()
  await expect(accepted).not.toHaveClass(/is-ghost/)
  await expect(page.locator('#sections button.card.is-ghost')).toHaveCount(all.length - 1)
  const graph = await (await page.request.get(`${server.url}/api/graph`)).json()
  console.log('16.2 accepted node:', JSON.stringify((graph.nodes ?? []).find?.((n: any) => n.id === target.id) ?? null), 'proposed:', JSON.stringify(graph.proposed))
  expect(graph.proposed).not.toContain(target.id)
  await page.screenshot({ path: join(HERE, 'test-results', '16.2-accepted.png'), fullPage: true })
})
