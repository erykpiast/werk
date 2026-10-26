/** Held-out steps 88.1–88.4: the merge loop schedules the builds, seen on the board. */
import { expect, test } from '../../e2e/harness.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { boardEvents, boardHistory, columnIn, gate, git, inColumn, judges, noSteps, open, planRun, result, said, ticketOf } from './browser.ts'

test.setTimeout(120_000)

/** Builder launch n writes t<n>.txt, then waits for the gate g<n>. */
const heldBuilders = (werk: Parameters<typeof gate>[0], count: number): FakeReply[] =>
  Array.from({ length: count }, (_, i) => ({
    steps: [said(`Launch ${i + 1}.`), { edit: { path: `t${i + 1}.txt`, content: `launch ${i + 1}\n` } }, { waitFor: gate(werk, `g${i + 1}`) }, result],
  }))

test('88.1 nothing builds before the person starts the run', async ({ page, werk }) => {
  await planRun(page, werk, [ticketOf(1), ticketOf(2), ticketOf(3)])
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: heldBuilders(werk, 3) } })
  // The person waits.
  await page.waitForTimeout(4000)
  for (const n of [1, 2, 3]) await expect(inColumn(page, 'ready', n)).toBeVisible()
  await expect(page.getByRole('region', { name: 'building', exact: true }).locator('li[data-ticket]')).toHaveCount(0)
  werk.start(['run', 'root'])
  for (const n of [1, 2, 3]) await expect(inColumn(page, 'building', n)).toBeVisible({ timeout: 15_000 })
  for (const g of ['g1', 'g2', 'g3']) open(werk, g)
})

test('88.2 four unblocked tickets with distinct modules build three at a time', async ({ page, werk }) => {
  await planRun(page, werk, [1, 2, 3, 4].map((n) => ticketOf(n)))
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: heldBuilders(werk, 4) } })
  const run = werk.start(['run', 'root'])
  const building = page.getByRole('region', { name: 'building', exact: true }).locator('li[data-ticket]')
  const ready = page.getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket]')
  await expect(building).toHaveCount(3, { timeout: 15_000 })
  await expect(ready).toHaveCount(1)
  await page.waitForTimeout(1500)
  await expect(building).toHaveCount(3)
  await expect(ready).toHaveCount(1)
  const fourth = Number(await ready.first().getAttribute('data-ticket'))

  open(werk, 'g1')
  const done = page.getByRole('region', { name: 'done', exact: true }).locator('li[data-ticket]')
  await expect(done).toHaveCount(1, { timeout: 20_000 })
  await expect(inColumn(page, 'building', fourth)).toBeVisible({ timeout: 15_000 })
  for (const g of ['g2', 'g3', 'g4']) open(werk, g)
  await run.exited
  // The fourth ticket's build holds the change of the ticket that merged first (launch 1 wrote t1.txt).
  const branch = boardEvents(werk).findLast((e) => e.type === 'ticket.moved' && e.payload.number === fourth && e.payload.branch !== undefined)
  expect(branch).toBeDefined()
  const files = git(werk, 'ls-tree', '--name-only', (branch!.payload as { branch: string }).branch).split('\n')
  expect(files).toContain('t1.txt')
  expect(files).toContain('t4.txt')
})

test('88.3 two tickets that touch a common module never build at the same time', async ({ page, werk }) => {
  await planRun(page, werk, [
    ticketOf(5, { touches: ['decision log'] }),
    ticketOf(6, { touches: ['decision log'] }),
    ticketOf(7, { touches: ['map view'] }),
  ])
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: heldBuilders(werk, 3) } })
  const run = werk.start(['run', 'root'])
  const building = page.getByRole('region', { name: 'building', exact: true }).locator('li[data-ticket]')
  await expect(building).toHaveCount(2, { timeout: 15_000 })
  await expect(inColumn(page, 'building', 7)).toBeVisible()
  const first = (await inColumn(page, 'building', 5).count()) === 1 ? 5 : 6
  const other = first === 5 ? 6 : 5
  await expect(inColumn(page, 'building', first)).toBeVisible()
  await expect(inColumn(page, 'ready', other)).toBeVisible()

  // The two builds that run end; the decision log ticket merges.
  open(werk, 'g1')
  open(werk, 'g2')
  await expect(inColumn(page, 'done', first)).toBeVisible({ timeout: 20_000 })
  await expect(inColumn(page, 'building', other)).toBeVisible({ timeout: 15_000 })
  open(werk, 'g3')
  await run.exited
  for (const board of boardHistory(werk)) {
    expect(columnIn(board, 5) === 'building' && columnIn(board, 6) === 'building').toBe(false)
  }
})

test('88.4 a ticket waits until its blocker is merged', async ({ page, werk }) => {
  await planRun(page, werk, [ticketOf(1), ticketOf(2, { blockedBy: [1] })])
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: heldBuilders(werk, 2) } })
  const run = werk.start(['run', 'root'])
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  await expect(inColumn(page, 'building', 2)).toHaveCount(0)
  open(werk, 'g1')
  await expect(inColumn(page, 'done', 1)).toBeVisible({ timeout: 20_000 })
  await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 15_000 })
  open(werk, 'g2')
  await run.exited
  for (const board of boardHistory(werk)) {
    const one = columnIn(board, 1)
    if (one === 'building' || one === 'merging') expect(columnIn(board, 2)).not.toBe('building')
  }
})
