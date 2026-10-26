/** Held-out steps 90.1–90.5: the pulse of a building ticket and the drawer's log preview. */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { gate, inColumn, judges, noSteps, open, planRun, result, said, ticket, ticketOf } from './browser.ts'

test.setTimeout(90_000)

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  await planRun(page, werk, [ticketOf(6)])
  await expect(inColumn(page, 'ready', 6)).toBeVisible()
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: { steps: [said('Working.'), { sleep: 3000 }, result] } } })
  const build = werk.start(['build', '6', '--cap', '1'])
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  await build.exited
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true')
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  await planRun(page, werk, [ticketOf(6)])
  const steps = Array.from({ length: 16 }, (_, i) => [said(`Event number ${i + 1}.`), { sleep: 1000 }]).flat()
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: { steps: [...steps, result] } } })
  werk.start(['build', '6', '--cap', '1'])
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await inColumn(page, 'building', 6).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  const log = drawer.getByRole('region', { name: 'agent log' })
  await expect(log).toBeVisible()
  const slice = drawer.getByRole('article', { name: 'slice' })
  expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  await expect(log).toContainText('Event number 1.')
  const lines = log.locator('ol')
  const h1 = (await lines.boundingBox())!.height
  await expect(log).toContainText('Event number 2.')
  // No reload: the new event arrives in the page as it is.
  await expect(log).toContainText('Event number 14.', { timeout: 30_000 })
  const h2 = (await lines.boundingBox())!.height
  expect(h2).toBe(h1)
  const scroll = await lines.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(scroll.sh).toBeGreaterThan(scroll.ch)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  // The check is slow only on the detached merge tree, so the ticket stays in merging for a while.
  await planRun(page, werk, [ticketOf(6, { checks: ['git symbolic-ref -q HEAD >/dev/null || sleep 8'] })])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), 'heldout-author': noSteps, builder: { steps: [said('Working.'), { waitFor: gate(werk, 'exit') }, result] } },
  })
  werk.start(['run', 'root'])
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await inColumn(page, 'building', 6).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer.getByRole('region', { name: 'agent log' })).toBeVisible()
  open(werk, 'exit')
  await expect(inColumn(page, 'merging', 6)).toBeVisible({ timeout: 20_000 })
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true')
  await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
  await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
  await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  await expect(inColumn(page, 'merging', 6)).toBeVisible()
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  // The check takes a few seconds, so the wait between the passes can be seen.
  await planRun(page, werk, [ticketOf(6, { checks: ['sleep 5; test -f done.txt'] })])
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      'heldout-author': noSteps,
      builder: [
        { steps: [said('First try.'), { waitFor: gate(werk, 'first') }, result], exit: 1 },
        { steps: [said('Second try.'), { waitFor: gate(werk, 'second') }, { edit: { path: 'done.txt', content: 'done\n' } }, result] },
      ],
    },
  })
  werk.start(['build', '6'])
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  open(werk, 'first')
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true')
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  open(werk, 'second')
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  await planRun(page, werk, [ticketOf(6)])
  werk.scriptAgent({ steps: [], roles: { ...judges(), 'heldout-author': noSteps, builder: { steps: [said('Working.'), { waitFor: gate(werk, 'never') }, result] } } })
  werk.start(['build', '6', '--cap', '1'])
  await expect(inColumn(page, 'building', 6)).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')

  // The person stops the build by hand: the build process and its agent.
  const ps = execSync('ps -axo pid=,ppid=,command=', { encoding: 'utf8' })
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m && Number(m[2]) === process.pid && m[3]!.includes('main.ts build 6')) process.kill(Number(m[1]), 'SIGTERM')
  }
  const meta = JSON.parse(readFileSync(join(werk.dir, '.werk', 'sessions', '6.json'), 'utf8')) as { pid: number }
  try {
    process.kill(-meta.pid, 'SIGTERM')
  } catch {
    process.kill(meta.pid, 'SIGTERM')
  }
  // The stop took effect: the agent process is gone.
  await expect
    .poll(() => {
      try {
        process.kill(meta.pid, 0)
        return 'alive'
      } catch {
        return 'gone'
      }
    })
    .toBe('gone')
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true')
  await expect(inColumn(page, 'ready', 6)).toBeVisible({ timeout: 15_000 })
  await ticket(page, 6).getByRole('link').click()
  await expect(page.getByRole('region', { name: 'drawer' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
})
