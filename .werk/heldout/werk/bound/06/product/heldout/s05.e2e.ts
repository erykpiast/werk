import { expect, test, type Page } from '@playwright/test'
import { setup } from './common.ts'
import type { Project } from './helpers.ts'

const RED = 'rgb(192, 57, 43)'
const GREY = 'rgb(138, 138, 138)'
const row = (page: Page, title: string) => page.getByRole('region', { name: 'sub-cards' }).getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })
/** Setup: a real decided card that depends_on `on`. */
function dependent(p: Project, id: string, title: string, on: string[], decide = true, more: string[] = []) {
  p.real(id, title, '--who', 'me', ...more)
  for (const t of on) p.ok('link', id, t, '--type', 'depends_on', '--why', `${id} needs ${t}`)
  p.ok('kill', id, 'revisit when the basis changes')
  if (decide) p.ok('decide', id)
}
/** The staleness listing, parsed: one block per card. */
function listing(p: Project): { kind: string; id: string; traces: string[] }[] {
  const out = p.werk('stale').stdout
  const blocks: { kind: string; id: string; traces: string[] }[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^(stale|paused|review)\s+#(\S+)/)
    if (m) blocks.push({ kind: m[1]!, id: m[2]!, traces: [] })
    else if (line.trim() && blocks.length) blocks.at(-1)!.traces.push(line.trim())
  }
  return blocks
}

test('05.1 a reopen without a reason is refused and leaves the map unchanged', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.decided('pricing', 'Pricing')
    dependent(p, 'checkout', 'Checkout', ['pricing'])
  })
  const before = p.log()
  const r = p.werk('reopen', 'pricing')
  expect(r.code).not.toBe(0)
  const first = r.out.split('\n')[0]!
  expect(first, 'the error line').toMatch(/reason/)
  expect(r.out).toMatch(/postponed/)
  expect(r.out).toMatch(/rejected/)
  expect(p.log()).toBe(before)
  expect(p.show('pricing').card.status).toBe('decided')
  await page.goto(`${s.url}/#pricing`)
  await expect(page.getByRole('region', { name: 'card detail' }).locator('.meta .status').first()).toHaveText('decided')
  expect(listing(p)).toEqual([])
  expect(p.werk('stale').stdout.trim()).toBe('nothing is marked')
})

test('05.2 a rejected reopen marks only the next hop stale, and a review moves the mark one hop on', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.decided('storage', 'Storage')
    dependent(p, 'api', 'API', ['storage'])
    dependent(p, 'client', 'Client', ['api'])
    p.real('schema', 'Schema', '--parent', 'storage', '--who', 'me')
    p.ok('kill', 'schema', 'never')
    p.ok('decide', 'schema')
  })
  expect(p.werk('reopen', 'storage', '--reason', 'rejected', '--why', 'the store loses writes').code).toBe(0)
  const l = listing(p)
  const api = l.find((b) => b.id === 'api')
  const schema = l.find((b) => b.id === 'schema')
  expect(api?.kind).toBe('stale')
  expect(schema?.kind).toBe('stale')
  expect(api!.traces.join(' ')).toMatch(/#storage reopened, rejected.*over depends_on/)
  expect(schema!.traces.join(' ')).toMatch(/#storage reopened, rejected.*over refines/)
  expect(l.find((b) => b.id === 'client')).toBeUndefined()
  await page.goto(`${s.url}/`)
  for (const t of ['API']) {
    await expect(row(page, t)).toHaveClass(/stale/)
    await expect(row(page, t).locator('.mark')).toHaveText('stale: rejected')
    await expect(row(page, t).locator('.mark')).toHaveCSS('color', RED)
  }
  await page.goto(`${s.url}/#storage`)
  await expect(row(page, 'Schema')).toHaveClass(/stale/)
  await expect(row(page, 'Schema').locator('.mark')).toHaveText('stale: rejected')
  await expect(row(page, 'Schema').locator('.mark')).toHaveCSS('color', RED)
  // The person reviews API and amends it.
  const amend = p.werk('edit', 'api', '--body', 'API reads from the new store.')
  const review = p.werk('decide', 'api')
  const after = listing(p)
  expect(after.find((b) => b.id === 'api'), `amend: ${amend.out} | review: ${review.out}`).toBeUndefined()
  expect(after.find((b) => b.id === 'schema')?.kind).toBe('stale')
  const client = after.find((b) => b.id === 'client')
  expect(client?.kind).toBe('stale')
  expect(client!.traces.join(' ')).toMatch(/#api/)
})

test('05.3 a postponed reopen pauses every downstream card in grey and keeps its status colour', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.decided('engine', 'Engine')
    dependent(p, 'parser', 'Parser', ['engine'])
    dependent(p, 'renderer', 'Renderer', ['parser'], false)
    dependent(p, 'export', 'Export', ['renderer'], false)
  })
  expect(p.werk('reopen', 'engine', '--reason', 'postponed', '--why', 'not this quarter').code).toBe(0)
  const l = listing(p)
  for (const id of ['parser', 'renderer', 'export']) {
    const b = l.find((x) => x.id === id)
    expect(b?.kind, id).toBe('paused')
    expect(b!.traces.join(' ')).toMatch(/#engine reopened, postponed/)
  }
  expect(l.filter((b) => b.kind === 'stale')).toEqual([])
  await page.goto(`${s.url}/`)
  for (const t of ['Parser', 'Renderer', 'Export']) {
    await expect(row(page, t)).toHaveClass(/paused/)
    await expect(row(page, t).locator('.mark')).toHaveText('paused: postponed')
    await expect(row(page, t).locator('.mark')).toHaveCSS('color', GREY)
  }
  await expect(row(page, 'Parser').locator('.status').first()).toHaveText('decided')
  await expect(row(page, 'Renderer').locator('.status').first()).toHaveText('open')
  const decidedColor = await row(page, 'Parser').locator('.status').first().evaluate((e) => getComputedStyle(e).color)
  const openColor = await row(page, 'Renderer').locator('.status').first().evaluate((e) => getComputedStyle(e).color)
  expect(decidedColor).not.toBe(GREY)
  expect(decidedColor).not.toBe(openColor)
  // The person resumes the work on Engine.
  const resume = p.werk('decide', 'engine')
  expect(resume.code, resume.out).toBe(0)
  expect(listing(p).filter((b) => b.kind === 'paused')).toEqual([])
  await expect(page.locator('.paused')).toHaveCount(0)
})

test('05.4 stale wins when a postponement and an invalidation reach the same card', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.decided('auth', 'Auth')
    p.decided('ledger', 'Ledger')
    dependent(p, 'billing', 'Billing', ['auth', 'ledger'])
    dependent(p, 'report', 'Report', ['billing'])
  })
  expect(p.werk('reopen', 'auth', '--reason', 'postponed', '--why', 'waits for the vendor').code).toBe(0)
  expect(p.werk('reopen', 'ledger', '--reason', 'rejected', '--why', 'double entry is wrong').code).toBe(0)
  const l = listing(p)
  const billing = l.filter((b) => b.id === 'billing')
  expect(billing.map((b) => b.kind)).toEqual(['stale'])
  expect(billing[0]!.traces.join(' ')).toMatch(/#ledger reopened, rejected/)
  const report = l.filter((b) => b.id === 'report')
  expect(report.map((b) => b.kind)).toEqual(['paused'])
  expect(report[0]!.traces.join(' ')).toMatch(/postponed/)
  await page.goto(`${s.url}/`)
  await expect(row(page, 'Billing')).toHaveClass(/stale/)
  await expect(row(page, 'Billing')).not.toHaveClass(/paused/)
  await expect(row(page, 'Billing').locator('.mark')).toHaveCSS('color', RED)
  await expect(row(page, 'Report')).toHaveClass(/paused/)
  await expect(row(page, 'Report').locator('.mark')).toHaveText('paused: postponed')
})

test('05.5 clearing one stale mark leaves the other marks in place', async ({ page }) => {
  const { p, s } = await setup((p) => {
    p.decided('index', 'Index')
    dependent(p, 'search', 'Search', ['index'])
    dependent(p, 'filters', 'Filters', ['index'])
    p.ok('reopen', 'index', '--reason', 'rejected', '--why', 'the index is wrong')
  })
  expect(listing(p).filter((b) => b.kind === 'stale').map((b) => b.id).sort()).toEqual(['filters', 'search'])
  // The person reviews Search and confirms it unchanged.
  const confirm = p.werk('decide', 'search')
  const l = listing(p)
  expect(l.find((b) => b.id === 'search'), `confirm: ${confirm.out}`).toBeUndefined()
  await page.goto(`${s.url}/`)
  await expect(row(page, 'Search')).not.toHaveClass(/stale/)
  const filters = l.find((b) => b.id === 'filters')
  expect(filters?.kind).toBe('stale')
  expect(filters!.traces.join(' ')).toMatch(/#index reopened, rejected/)
  await expect(row(page, 'Filters')).toHaveClass(/stale/)
})
