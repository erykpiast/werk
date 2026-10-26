import type { Page } from '@playwright/test'
import { expect, test } from '../../../e2e/harness.ts'
import { column, inColumn, reply, said, setup, ticket } from './util.ts'
import type { FakeStep } from '../../../src/test/fake-agent.ts'

const ONE = [{ number: 1, title: 'The one ticket', touches: ['m'] }]
/** The person starts the build: the board's start control of the plan run (the only ticket builds). */
const pressStart = (page: Page) => page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of map' }).click()
const agentLog = (page: Page) => page.getByRole('region', { name: 'drawer' }).getByRole('region', { name: 'agent log' })

// 90.1
// Scenario: A building ticket pulses while its fake builder runs and stops when the pass exits
// Given a board with one ticket in the ready column
// And the builder for this project is a fake agent that runs for a few seconds and then exits
// When the person starts the build of that ticket
// Then the ticket moves to the building column
// And the ticket card on the board pulses
// When the fake agent's pass exits
// Then the ticket card stops pulsing
test('90.1', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = await setup(page, werk, {
    tickets: ONE,
    builders: [{ steps: [said('Working.'), { sleep: 4000 }, { edit: { path: 'one.txt', content: 'one\n' } }, ...reply({}).steps] }],
    // The checks after the pass wait on a gate, so the ticket stays in building after the pass exits.
    holdBuildChecks: true,
  })
  try {
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    await pressStart(page)
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 30_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 10_000 })
    const anim = await ticket(page, 1).evaluate((el) => getComputedStyle(el).animationName)
    expect(anim).toBe('pulse')
    // The pass exits after about 4 s.
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
    await expect(inColumn(page, 'building', 1)).toBeVisible()
    expect(await ticket(page, 1).evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  } finally {
    s.cleanup()
  }
})

// 90.2
// Scenario: The drawer of a building ticket shows the agent's log as it arrives
// Given a board with one ticket in the ready column
// And the builder for this project is a fake agent that writes a new log event every second
// When the person starts the build of that ticket
// And the person clicks the ticket card in the building column
// Then the drawer opens beneath the board
// And the drawer shows a log preview above the slice
// And the log preview shows the fake agent's first event
// When the fake agent writes its next event
// Then the log preview shows the new event without the person reloading the page
// And the log preview stays the same height while its content scrolls
test('90.2', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const steps: FakeStep[] = []
  for (let i = 1; i <= 24; i++) steps.push(said(`event ${i}`), { sleep: 1000 })
  const s = await setup(page, werk, {
    tickets: ONE,
    builders: [{ steps: [...steps, { edit: { path: 'one.txt', content: 'one\n' } }, ...reply({}).steps] }],
    holdBuildChecks: true,
  })
  try {
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    await pressStart(page)
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 30_000 })
    await column(page, 'building').locator('li[data-ticket="1"]').getByRole('link').click()
    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer).toBeVisible()
    const board = (await page.locator('.board').boundingBox())!
    expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
    const log = agentLog(page)
    await expect(log).toBeVisible()
    const slice = drawer.getByRole('article', { name: 'slice' })
    expect((await log.boundingBox())!.y + (await log.boundingBox())!.height).toBeLessThanOrEqual((await slice.boundingBox())!.y)
    await expect(log.getByRole('listitem').first()).toHaveText(/event 1$/, { timeout: 15_000 })
    const h1 = (await log.boundingBox())!.height
    const seen = await log.getByRole('listitem').count()
    await expect(log.getByRole('listitem').nth(seen)).toHaveText(new RegExp(`event ${seen + 1}$`), { timeout: 10_000 })
    // Wait (no reload) until the lines overflow the viewport.
    await expect(log.getByRole('listitem')).toHaveCount(18, { timeout: 30_000 })
    const lines = log.getByRole('list')
    const { scrollHeight, clientHeight, scrollTop } = await lines.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop }))
    expect(scrollHeight).toBeGreaterThan(clientHeight)
    expect(scrollTop).toBeGreaterThan(0)
    const h2 = (await log.boundingBox())!.height
    expect(Math.abs(h2 - h1)).toBeLessThanOrEqual(1)
  } finally {
    s.cleanup()
  }
})

// 90.3
// Scenario: The log preview is gone after the ticket moves to merging
// Given a ticket in the building column with a running fake agent
// And the person has the drawer of that ticket open with the log preview visible
// When the fake agent's pass exits and the ticket moves to the merging column
// Then the ticket card is in the merging column
// And the ticket card does not pulse
// And the drawer of the ticket shows the slice and the sidebar
// But the drawer shows no log preview
test('90.3', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = await setup(page, werk, {
    tickets: ONE,
    builders: (gate) => [{ steps: [said('Working.'), { waitFor: gate('exit') }, { edit: { path: 'one.txt', content: 'one\n' } }, ...reply({}).steps] }],
    // The merge queue's check waits on a gate, so the ticket stays in merging.
    mergeHoldIf: 'one.txt',
  })
  try {
    await pressStart(page)
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
    await ticket(page, 1).getByRole('link').click()
    await expect(agentLog(page)).toBeVisible()
    await expect(agentLog(page).getByRole('listitem').first()).toHaveText(/Working\.$/)

    s.open('exit')
    await expect(inColumn(page, 'merging', 1)).toBeVisible({ timeout: 60_000 })
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer).toHaveAttribute('data-ticket', '1')
    await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
    await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  } finally {
    s.cleanup()
  }
})

// 90.4
// Scenario: A failed attempt stops the pulse while the ticket waits for its retry
// Given a board with one ticket in the ready column
// And the builder for this project is a fake agent whose first pass fails
// When the person starts the build of that ticket
// Then the ticket card in the building column pulses
// When the fake agent's first pass exits with a failure
// Then the ticket card stops pulsing
// And the ticket card stays in the building column while it waits for the next attempt
test('90.4', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = await setup(page, werk, {
    tickets: ONE,
    builders: (gate) => [
      // Pass 1: writes a red result (make check is red on "red") and exits 1.
      { steps: [said('Pass one.'), { sleep: 3000 }, { edit: { path: 'red.txt', content: 'red\n' } }], exit: 1 },
      // Pass 2 is held at its start.
      { steps: [{ waitFor: gate('g2') }, said('Pass two.'), { edit: { path: 'red.txt', content: 'fixed\n' } }, ...reply({}).steps] },
    ],
    // The checks of pass 1 wait on a gate: the time between the exit of pass 1 and the next attempt.
    holdBuildChecks: true,
  })
  try {
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    await pressStart(page)
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 30_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 10_000 })
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
    await expect(inColumn(page, 'building', 1)).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
    await expect(inColumn(page, 'building', 1)).toBeVisible()
    // Release the checks: pass 1 is red, a retry is recorded, and pass 2 starts (held by g2).
    s.open('build-go')
    await expect.poll(() => s.events().filter((e) => e.type === 'ticket.retried').length, { timeout: 30_000 }).toBe(1)
    await expect(inColumn(page, 'building', 1)).toBeVisible()
  } finally {
    s.cleanup()
  }
})

// 90.5
// Scenario: A person stops the build by hand and the pulse and preview end
// Given a ticket in the building column with a running fake agent
// And the ticket card pulses
// When the person stops the build of that ticket by hand
// Then the ticket card stops pulsing
// When the ticket moves back to the ready column
// And the person opens the drawer of that ticket
// Then the drawer shows no log preview
test('90.5', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = await setup(page, werk, {
    tickets: ONE,
    builders: (gate) => [{ steps: [said('Working.'), { waitFor: gate('never') }, ...reply({}).steps] }],
  })
  try {
    await pressStart(page)
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 30_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
    // The stop by hand: the drag from building back to ready.
    await ticket(page, 1).dragTo(column(page, 'ready'))
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    // The server no longer reports a running session for the ticket (its agent stopped).
    await expect
      .poll(async () => ((await (await page.request.get(`${werk.url}api/board`)).json()) as { running: number[] }).running, { timeout: 20_000 })
      .toEqual([])
    await ticket(page, 1).getByRole('link').click()
    await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', '1')
    await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  } finally {
    s.cleanup()
  }
})
