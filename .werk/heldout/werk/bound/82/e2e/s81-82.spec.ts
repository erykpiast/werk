import type { Page } from '@playwright/test'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const FIX = join(import.meta.dirname, '..', '..', 'e2e', 'fixture-project', '.werk', 'board.jsonl')
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const toBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}
/** Appends Given board events to the project's board log. */
function boardEvents(werk: Werk, events: object[]) {
  const path = join(werk.dir, '.werk', 'board.jsonl')
  const prev = readFileSync(path, 'utf8').trim().split('\n').length
  appendFileSync(path, events.map((e, i) => JSON.stringify({ seq: prev + i + 1, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n')
}

test('81.1 every fixture ticket sits in the column its last event names', async ({ page }) => {
  await toBoard(page)
  const names = await page.locator('section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(names).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  const events = readFileSync(FIX, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const last = new Map<number, string>()
  for (const e of events) {
    if (e.type === 'ticket.planned' && !last.has(e.payload.number)) last.set(e.payload.number, 'ready')
    if (e.type === 'ticket.moved') last.set(e.payload.number, e.payload.to)
  }
  for (const [n, col] of last) {
    await expect(page.locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
    await expect(column(page, col).locator(`li[data-ticket="${n}"]`)).toHaveCount(1)
  }
  // Ticket 5 moved to building, then to merging.
  await expect(column(page, 'merging').locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(column(page, 'building').locator('li[data-ticket="5"]')).toHaveCount(0)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await toBoard(page)
  await expect(ticket(page, 2).getByRole('link')).toHaveText('Draw the map in a browser')
  await expect(ticket(page, 2).locator('[data-badge="retries"]')).toContainText('2')
  await expect(ticket(page, 3).getByRole('link')).toHaveText('Open a card from the address bar')
  await expect(ticket(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const n of [2, 3]) {
    const text = (await ticket(page, n).innerText()).toLowerCase()
    expect(text).not.toContain('what to build')
    expect(text).not.toContain('#map')
    expect(text).not.toContain('make ')
  }
})

test('81.3 a ticket card counts only the blockers that are not done', async ({ page, werk }) => {
  // Given: a ticket blocked by one done ticket (1) and one ready ticket (3).
  boardEvents(werk, [
    { type: 'ticket.planned', payload: { number: 6, title: 'Blocked by a done and a ready ticket', cites: ['map'], blockedBy: [1, 3], stories: [1], touches: ['map view'], checks: ['make test'], brief: '## What to build\n\nX.' } },
  ])
  await toBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket="3"]')).toHaveCount(1)
  await expect(column(page, 'done').locator('li[data-ticket="1"]')).toHaveCount(1)
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).toContainText('1')
  await expect(ticket(page, 6).locator('[data-badge="blockers"]')).not.toContainText('2')
  // Ticket 4 has no blockers.
  await expect(ticket(page, 4).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const brief = '## What to build\n\n' + 'A long brief line that keeps going. '.repeat(20) + '\n\n## Acceptance criteria\n\n- [ ] The last line of the long brief.'
  boardEvents(werk, [
    { type: 'ticket.planned', payload: { number: 7, title: 'A ticket with everything', cites: ['map', 'map-hash'], blockedBy: [2], stories: [1], touches: ['map view'], checks: ['make test', 'make e2e'], brief } },
    { type: 'ticket.retried', payload: { number: 7 } },
    { type: 'ticket.retried', payload: { number: 7 } },
  ])
  await toBoard(page)
  await ticket(page, 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  const meta = drawer.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('The last line of the long brief.')
  await expect(slice).toContainText('A long brief line that keeps going. A long brief line')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(meta.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(meta.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(meta).toContainText('retries2')
  await expect(meta.getByRole('list', { name: 'checks' })).toContainText('make e2e')
  const l = (await slice.boundingBox())!
  const r = (await meta.boundingBox())!
  expect(l.x + l.width).toBeLessThanOrEqual(r.x)
  const board = page.locator('.board')
  await expect(board).toBeVisible()
  for (const c of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, c)).toBeVisible()
  const b = (await board.boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(b.y + b.height)
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await toBoard(page)
  const before = await page.locator('section[data-column]').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('aria-label'), [...e.querySelectorAll('li[data-ticket]')].map((t) => t.getAttribute('data-ticket'))]),
  )
  await ticket(page, 3).getByRole('link').click()
  await page.getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page.getByRole('list', { name: 'map' }).or(page.getByTestId('card'))).toBeVisible()
  await expect(page.locator('section[data-column]')).toHaveCount(0)
  const detail = page.getByTestId('card')
  await expect(detail).toHaveAttribute('data-card-id', 'map-hash')
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText('The open card lives in the location hash')
  await expect(detail).toContainText('The address bar names the open card.')
  await toBoard(page)
  const after = await page.locator('section[data-column]').evaluateAll((els) =>
    els.map((e) => [e.getAttribute('aria-label'), [...e.querySelectorAll('li[data-ticket]')].map((t) => t.getAttribute('data-ticket'))]),
  )
  expect(after).toEqual(before)
})

test('82.1 a plan over a decided subtree records a feature run, writes a spec and tickets, and proposes the answers', async ({ page, werk }) => {
  // Given: a decided subtree under "auth", as log events.
  const log = join(werk.dir, '.werk', 'log.jsonl')
  const prev = readFileSync(log, 'utf8').trim().split('\n').length
  const ev = [
    { type: 'node.proposed', payload: { id: 'auth', kind: 'card', title: 'Auth', status: 'decided', who: 'you' } },
    { type: 'node.accepted', actor: 'you', payload: { id: 'auth' } },
    { type: 'node.proposed', payload: { id: 'auth-session', kind: 'card', title: 'Session', status: 'decided', parent: 'auth' } },
    { type: 'node.accepted', actor: 'you', payload: { id: 'auth-session' } },
  ]
  appendFileSync(log, ev.map((e, i) => JSON.stringify({ seq: prev + i + 1, at: '2026-10-21T02:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n')
  const boardBefore = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').length
  const PLAN = '.werk/plans/auth'
  const spec = '# Spec\n\n## User Stories\n\n1. As a person, I log in.\n2. As a person, I log out.\n'
  const t = (title: string, story: number) =>
    `title: ${title}\ncites: auth, auth-session\nblocked_by:\nstories: ${story}\ntouches: auth flow\n\n## What to build\n\nBuild ${title}.\n\n## Acceptance criteria\n\n- [ ] It works.\n\n## Checks\n\n- \`make test\`\n`
  const a = (slug: string) => ({ slug, title: `Title ${slug}`, why: `Why ${slug}`, body: `Body ${slug}` })
  const edit = (path: string, content: string) => ({ edit: { path, content } })
  writeFileSync(
    join(werk.dir, '..', 'agent-script.json'),
    JSON.stringify({
      steps: [],
      roles: {
        'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec), edit(`${PLAN}/spec.answers.json`, JSON.stringify([a('token-ttl')]))] },
        'ticket-writer': {
          steps: [edit(`${PLAN}/tickets/11-login.md`, t('Log in with a magic link', 1)), edit(`${PLAN}/tickets/12-logout.md`, t('Log out everywhere', 2)), edit(`${PLAN}/tickets.answers.json`, JSON.stringify([a('split-login')]))],
        },
      },
    }),
  )
  let out = ''
  try {
    out = werk.cli(['plan', 'auth'])
  } catch (e) {
    out = String(e)
  }
  console.log('82.1 plan:', out)
  const runEvents = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').slice(boardBefore).map((l) => JSON.parse(l))
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })

  await toBoard(page)
  await expect(page.locator('li[data-ticket="11"]')).toContainText('Log in with a magic link')
  await expect(page.locator('li[data-ticket="12"]')).toContainText('Log out everywhere')

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Map' }).click()
  for (const slug of ['token-ttl', 'split-login']) {
    const li = page.locator(`li[data-card-id="auth"] > ul > li[data-card-id="auth-${slug}"]`)
    await expect(li).toHaveAttribute('data-proposed', 'true')
  }
  for (const slug of ['token-ttl', 'split-login']) {
    await page.goto(`${werk.url}#auth-${slug}`)
    const detail = page.getByTestId('card')
    await expect(detail).toHaveAttribute('data-proposed', 'true')
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText(`Title ${slug}`)
    await expect(detail).toContainText(`Why ${slug}`)
    await expect(detail).toContainText(`Body ${slug}`)
    await expect(detail).toContainText('me')
    await expect(page.getByRole('navigation', { name: 'breadcrumbs' })).toContainText('Auth')
    await page.getByRole('button', { name: /✓|Accept/ }).click()
    await expect(detail).toHaveAttribute('data-proposed', 'false')
    const other = slug === 'token-ttl' ? 'split-login' : null
    if (other) {
      const graph = await (await page.request.get(`${werk.url}api/graph`)).json()
      expect(graph.nodes.find((n: { id: string }) => n.id === `auth-${other}`).proposed).toBe(true)
    }
  }
})
