/** Held-out steps 90.x: the pulse of a building ticket and the live log preview in its drawer. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'
import { activeRun, alive, card, column, inColumn, judges, killRuns, planRun, reply, said, sessionPid, ticket } from './h89-90-lib.ts'

test.afterEach(({ werk }) => killRuns(werk))

const drawer = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'drawer' })

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  test.setTimeout(90_000)
  // Given a board with one ticket in the ready column
  await planRun(page, werk, [ticket(1, 'Pulse me')])
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  // And the builder for this project is a fake agent that runs for a few seconds and then exits
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { sleep: 4_000 }, ...reply({}).steps] } } })
  // When the person starts the build of that ticket
  const build = werk.start(['build', '1', '--cap', '1'])
  // Then the ticket moves to the building column
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  // And the ticket card on the board pulses
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true')
  // When the fake agent's pass exits
  // Then the ticket card stops pulsing
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await build.exited
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  test.setTimeout(90_000)
  // Given a board with one ticket in the ready column
  await planRun(page, werk, [ticket(1, 'Log me')])
  // And the builder for this project is a fake agent that writes a new log event every second
  const steps = Array.from({ length: 16 }, (_, i) => [said(`event number ${i + 1}`), { sleep: 1_000 }]).flat()
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [...steps, ...reply({}).steps] } } })
  // When the person starts the build of that ticket
  werk.start(['build', '1', '--cap', '1'])
  // And the person clicks the ticket card in the building column
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await inColumn(page, 'building', 1).getByRole('link').click()
  // Then the drawer opens beneath the board
  await expect(drawer(page)).toBeVisible()
  const board = (await page.locator('.board').boundingBox())!
  expect((await drawer(page).boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  // And the drawer shows a log preview above the slice
  const log = drawer(page).getByRole('region', { name: 'agent log' })
  const slice = drawer(page).getByRole('article', { name: 'slice' })
  await expect(log).toBeVisible()
  expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  // And the log preview shows the fake agent's first event
  await expect(log.getByRole('listitem').first()).toHaveText(/event number 1$/)
  const heightEarly = (await log.boundingBox())!.height
  // When the fake agent writes its next event
  // Then the log preview shows the new event without the person reloading the page
  await expect(log.getByRole('listitem').nth(1)).toHaveText(/event number 2$/)
  // And the log preview stays the same height while its content scrolls
  await expect(log.getByRole('listitem').filter({ hasText: /event number 16$/ })).toHaveCount(1, { timeout: 30_000 })
  const heightLate = (await log.boundingBox())!.height
  expect(heightLate).toBe(heightEarly)
  const lines = log.locator('ol')
  const overflow = await lines.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }))
  expect(overflow.scroll).toBeGreaterThan(overflow.client)
  expect(overflow.top).toBeGreaterThan(0)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const gate = join(werk.dir, '..', 'exit')
  // Given a ticket in the building column with a running fake agent
  // The merge queue's check, on a detached tree, takes a few seconds, so the ticket sits in merging.
  const makefile = 'check:\n\t@git symbolic-ref -q HEAD >/dev/null || sleep 8\n'
  await planRun(page, werk, [ticket(1, 'Merge me')], makefile)
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: { steps: [said('Working.'), { waitFor: gate }, { edit: { path: 'one.txt', content: 'one\n' } }, ...reply({}).steps] } },
  })
  werk.start(['run', 'root', '--poll-every', '100'])
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  // And the person has the drawer of that ticket open with the log preview visible
  await card(page, 1).getByRole('link').click()
  const log = drawer(page).getByRole('region', { name: 'agent log' })
  await expect(log.getByRole('listitem').first()).toHaveText(/Working\.$/)
  // When the fake agent's pass exits and the ticket moves to the merging column
  writeFileSync(gate, '')
  // Then the ticket card is in the merging column
  await expect(inColumn(page, 'merging', 1)).toBeVisible({ timeout: 30_000 })
  // And the ticket card does not pulse
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true')
  // And the drawer of the ticket shows the slice and the sidebar
  await expect(drawer(page)).toHaveAttribute('data-ticket', '1')
  await expect(drawer(page).getByRole('article', { name: 'slice' })).toBeVisible()
  await expect(drawer(page).getByRole('complementary', { name: 'metadata' })).toBeVisible()
  // But the drawer shows no log preview
  await expect(drawer(page).getByRole('region', { name: 'agent log' })).toHaveCount(0)
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  test.setTimeout(90_000)
  // Given a board with one ticket in the ready column
  // The check takes a few seconds and is red until the builder writes ok.txt.
  await planRun(page, werk, [ticket(1, 'Retry me')], 'check:\n\t@sleep 4; test -f ok.txt\n')
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  // And the builder for this project is a fake agent whose first pass fails
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [
        { steps: [said('First try.'), { sleep: 3_000 }, ...reply({}).steps] },
        { steps: [said('Second try.'), { waitFor: join(werk.dir, '..', 'never') }] },
      ],
    },
  })
  // When the person starts the build of that ticket
  werk.start(['build', '1', '--cap', '2'])
  // Then the ticket card in the building column pulses
  await expect(inColumn(page, 'building', 1)).toHaveAttribute('data-live', 'true')
  // When the fake agent's first pass exits with a failure
  // Then the ticket card stops pulsing
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 15_000 })
  // And the ticket card stays in the building column while it waits for the next attempt
  await expect(inColumn(page, 'building', 1)).toBeVisible()
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  test.setTimeout(90_000)
  // Given a ticket in the building column with a running fake agent
  await planRun(page, werk, [ticket(1, 'Stop me')])
  activeRun(werk)
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { waitFor: join(werk.dir, '..', 'never') }] } } })
  werk.start(['build', '1', '--cap', '1'])
  // And the ticket card pulses
  await expect(inColumn(page, 'building', 1)).toHaveAttribute('data-live', 'true')
  const pid = sessionPid(werk, 1)
  // When the person stops the build of that ticket by hand (a drag back to ready)
  await card(page, 1).dragTo(column(page, 'ready'))
  // Then the ticket card stops pulsing
  await expect(card(page, 1)).not.toHaveAttribute('data-live', 'true')
  // When the ticket moves back to the ready column
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  expect(alive(pid)).toBe(false)
  // And the person opens the drawer of that ticket
  await card(page, 1).getByRole('link').click()
  // Then the drawer shows no log preview
  await expect(drawer(page)).toHaveAttribute('data-ticket', '1')
  await expect(drawer(page).getByRole('region', { name: 'agent log' })).toHaveCount(0)
})
