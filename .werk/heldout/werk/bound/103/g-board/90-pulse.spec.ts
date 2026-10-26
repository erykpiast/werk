/** Held-out steps 90.1 - 90.5: the pulse of a building ticket and the live log preview. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { appendBoard, commitFile, inColumn, judgesAndHeldout, killRuns, openBoard, planned, result, said, ticket } from './helpers.ts'

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  appendBoard(werk.dir, planned({ number: 7, title: 'Pulse ticket' }))
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working.'), { sleep: 4_000 }, result] }, ...judgesAndHeldout([7]) } })
  await openBoard(page, werk)
  await expect(inColumn(page, 'ready', 7)).toBeVisible()
  const build = werk.start(['build', '7', '--cap', '1'])
  await expect(inColumn(page, 'building', 7)).toBeVisible({ timeout: 15_000 })
  await expect(ticket(page, 7)).toHaveAttribute('data-live', 'true', { timeout: 10_000 })
  await expect(ticket(page, 7)).not.toHaveAttribute('data-live', /.*/, { timeout: 20_000 })
  await build.exited
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  test.setTimeout(90_000)
  appendBoard(werk.dir, planned({ number: 7, title: 'Log ticket' }))
  const steps = []
  for (let i = 1; i <= 20; i++) steps.push(said(`Event number ${i}.`), { sleep: 1_000 })
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [...steps, result] }, ...judgesAndHeldout([7]) } })
  await openBoard(page, werk)
  werk.start(['build', '7', '--cap', '1'])
  await expect(inColumn(page, 'building', 7)).toBeVisible({ timeout: 15_000 })
  await inColumn(page, 'building', 7).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height - 1)
  const log = drawer.getByRole('region', { name: 'agent log' })
  await expect(log).toBeVisible()
  expect((await log.boundingBox())!.y).toBeLessThan((await drawer.getByRole('article', { name: 'slice' }).boundingBox())!.y)
  await expect(log).toContainText('Event number 1.')
  await expect(log).toContainText('Event number 2.', { timeout: 5_000 })
  const h1 = (await log.boundingBox())!.height
  await expect(log).toContainText('Event number 18.', { timeout: 30_000 })
  const h2 = (await log.boundingBox())!.height
  expect(Math.abs(h2 - h1)).toBeLessThanOrEqual(1)
  const scrolls = await log.locator('ol').evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(scrolls).toBe(true)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // The check sleeps on the merge queue's detached tree, so the ticket stays in merging for a while.
  appendBoard(werk.dir, planned({ number: 7, title: 'Merging ticket', root: 'zz', checks: ['git symbolic-ref -q HEAD >/dev/null || sleep 8'] }))
  const gate = join(werk.dir, '..', 'exit-now')
  werk.scriptAgent({
    steps: [],
    roles: { builder: { steps: [{ edit: { path: 'merged.txt', content: 'x\n' } }, said('Working.'), { waitFor: gate }, result] }, ...judgesAndHeldout([7]) },
  })
  await openBoard(page, werk)
  try {
    werk.start(['run', 'zz', '--poll-every', '100'])
    await expect(inColumn(page, 'building', 7)).toBeVisible({ timeout: 15_000 })
    await inColumn(page, 'building', 7).getByRole('link').click()
    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer.getByRole('region', { name: 'agent log' })).toContainText('Working.', { timeout: 10_000 })
    writeFileSync(gate, '')
    await expect(inColumn(page, 'merging', 7)).toBeVisible({ timeout: 30_000 })
    await expect(ticket(page, 7)).not.toHaveAttribute('data-live', /.*/)
    await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
    await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
    await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  } finally {
    killRuns(werk)
  }
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  // The check takes 5 s and is red until the second pass writes ok.txt.
  appendBoard(werk.dir, planned({ number: 7, title: 'Retry ticket', checks: ['sleep 5; test -f ok.txt'] }))
  werk.scriptAgent({
    steps: [],
    roles: {
      builder: [
        { steps: [said('First pass.'), { sleep: 2_000 }, result], exit: 1 },
        { steps: [said('Second pass.'), { waitFor: join(werk.dir, '..', 'never') }] },
      ],
      ...judgesAndHeldout([7]),
    },
  })
  await openBoard(page, werk)
  werk.start(['build', '7', '--cap', '2'])
  await expect(inColumn(page, 'building', 7)).toBeVisible({ timeout: 15_000 })
  await expect(ticket(page, 7)).toHaveAttribute('data-live', 'true', { timeout: 10_000 })
  await expect(ticket(page, 7)).not.toHaveAttribute('data-live', /.*/, { timeout: 10_000 })
  await expect(inColumn(page, 'building', 7)).toBeVisible()
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  appendBoard(werk.dir, planned({ number: 7, title: 'Stop ticket' }))
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working.'), { waitFor: join(werk.dir, '..', 'never') }] }, ...judgesAndHeldout([7]) } })
  await openBoard(page, werk)
  werk.start(['build', '7', '--cap', '2'])
  await expect(ticket(page, 7)).toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  // The board's one way to stop a build by hand is archive; a drag back to ready is refused.
  await ticket(page, 7).getByRole('button', { name: /archive/i }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(page.locator('li[data-ticket="7"][data-live]')).toHaveCount(0)
  // The step: the ticket moves back to the ready column.
  await expect(inColumn(page, 'ready', 7)).toBeVisible({ timeout: 10_000 })
  await inColumn(page, 'ready', 7).getByRole('link').click()
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})
void commitFile
