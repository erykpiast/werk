import { expect, test } from '../../../e2e/harness.ts'
import { column, inColumn, numbers, reply, said, setup, ticket } from './util.ts'
import type { FakeReply } from '../../../src/test/fake-agent.ts'

const writes = (path: string, holdOn?: string): FakeReply => ({
  steps: [said(`building ${path}`), ...(holdOn ? [{ waitFor: holdOn }] : []), { edit: { path, content: `${path}\n` } }, ...reply({}).steps],
})
const SLOW = ['--silence-limit', '600000', '--poll-every', '200']

// 89.1
// Scenario: Nothing builds before the start, and the start builds the tickets in the order the person chose
// Given a plan run with two ready tickets, "Alpha" above "Beta", that change the same module
// And the merge loop is not started
// When the person waits on the board
// Then both tickets stay in ready
// When the person drags "Beta" above "Alpha" within ready
// And the person reloads the board
// Then "Beta" shows above "Alpha" in ready
// When the person presses the control that starts the merge loop on the plan run
// Then "Beta" moves to building
// And "Alpha" stays in ready while "Beta" builds
// And "Beta" later moves through merging to done, and then "Alpha" moves to building
test('89.1', async ({ page, werk }) => {
  test.setTimeout(180_000)
  const s = await setup(page, werk, {
    tickets: [
      { number: 1, title: 'Alpha', touches: ['shared module'] },
      { number: 2, title: 'Beta', touches: ['shared module'] },
    ],
    // Builder launch 1 writes beta.txt and waits for g1; launch 2 writes alpha.txt and waits for g2.
    builders: (gate) => [writes('beta.txt', gate('g1')), writes('alpha.txt', gate('g2'))],
    mergeHoldIf: 'beta.txt',
  })
  try {
    await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])
    await page.waitForTimeout(4000) // the person waits on the board
    await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])
    await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)
    expect(s.events().filter((e) => e.type === 'run.started' || e.type === 'ticket.moved')).toEqual([])

    await ticket(page, 2).dragTo(ticket(page, 1))
    await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])
    await page.reload()
    await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])

    await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of map' }).click()
    await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 30_000 })
    await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
    await page.waitForTimeout(1500)
    await expect(inColumn(page, 'ready', 1)).toBeVisible()

    s.open('g1')
    await expect(inColumn(page, 'merging', 2)).toBeVisible({ timeout: 60_000 })
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    s.open('merge-go')
    await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 60_000 })
    const ev = s.events()
    const at = (n: number, to: string) => ev.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n && e.payload.to === to)
    expect(at(2, 'building')).toBeGreaterThanOrEqual(0)
    expect(at(2, 'building')).toBeLessThan(at(2, 'merging'))
    expect(at(2, 'merging')).toBeLessThan(at(2, 'done'))
    expect(at(2, 'done')).toBeLessThan(at(1, 'building'))
  } finally {
    s.cleanup()
  }
})

// 89.2
// Scenario: A person archives a ready ticket and restores it
// Given a plan run with a ready ticket "Gamma", a blocked ticket "Delta", and a building ticket "Epsilon"
// When the person looks at the three tickets on the board
// Then "Gamma" and "Delta" each show an archive action
// But "Epsilon" shows no archive action
// When the person presses archive on "Gamma"
// Then a confirmation appears that says the ticket can be restored
// When the person confirms
// Then "Gamma" is gone from the board
// And "Gamma" stays gone after the person reloads the board
// When the person restores "Gamma" through the restore verb
// Then "Gamma" shows again in ready on the board
test('89.2', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = await setup(page, werk, {
    tickets: [
      { number: 1, title: 'Gamma', touches: ['g'] },
      { number: 2, title: 'Delta', touches: ['d'] },
      { number: 3, title: 'Epsilon', touches: ['e'] },
    ],
    extra: [
      { type: 'ticket.moved', payload: { number: 2, to: 'blocked', reason: 'blocked_by: waits on a decision' } },
      { type: 'ticket.moved', payload: { number: 3, to: 'building' } },
    ],
    builders: [],
  })
  try {
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    await expect(inColumn(page, 'blocked', 2)).toBeVisible()
    await expect(inColumn(page, 'building', 3)).toBeVisible()
    await expect(ticket(page, 1).getByRole('button', { name: 'Archive ticket 1' })).toBeVisible()
    await expect(ticket(page, 2).getByRole('button', { name: 'Archive ticket 2' })).toBeVisible()
    await expect(ticket(page, 3).getByRole('button', { name: /archive/i })).toHaveCount(0)

    await ticket(page, 1).getByRole('button', { name: 'Archive ticket 1' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/restore/i)
    await dialog.getByRole('button', { name: 'Archive' }).click()
    await expect(ticket(page, 1)).toHaveCount(0)
    await page.reload()
    await expect(inColumn(page, 'blocked', 2)).toBeVisible()
    await expect(ticket(page, 1)).toHaveCount(0)

    werk.cli(['ticket', 'restore', '1'])
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    await expect(ticket(page, 1)).toContainText('Gamma')
  } finally {
    s.cleanup()
  }
})

// 89.3
// Scenario: A person starts one ready ticket early with the trigger icon, and it goes through the merge queue
// Given an active run in which a ticket builds and a ready ticket "Zeta" waits
// When the person presses the trigger icon on "Zeta"
// Then "Zeta" moves to building
// And "Zeta" later moves to merging
// And "Zeta" then moves to done
test('89.3', async ({ page, werk }) => {
  test.setTimeout(180_000)
  const s = await setup(page, werk, {
    tickets: [
      { number: 1, title: 'Builds first', touches: ['a'] },
      { number: 2, title: 'Zeta', touches: ['z'] },
    ],
    builders: (gate) => [writes('a.txt', gate('g1')), writes('zeta.txt')],
    mergeHoldIf: 'zeta.txt',
  })
  // The active run: one build at a time, so Zeta waits in ready while ticket 1 builds.
  werk.start(['run', 'map', '--parallel', '1', ...SLOW])
  try {
    await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('the run of map is active', { timeout: 30_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()

    await ticket(page, 2).getByRole('button', { name: 'Trigger ticket 2' }).click()
    await expect(inColumn(page, 'building', 2)).toBeVisible()
    s.open('g1')
    await expect(inColumn(page, 'merging', 2)).toBeVisible({ timeout: 90_000 })
    s.open('merge-go')
    await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
  } finally {
    s.cleanup()
  }
})

// 89.4
// Scenario: A person starts a ticket by a drag into building, then stops it by a drag back into ready
// Given an active run with a ready ticket "Eta"
// When the person drags "Eta" from ready into building
// Then "Eta" shows in building and its build runs
// When the person drags "Eta" from building back into ready
// Then "Eta" shows in ready
// And the build of "Eta" stops and does not move "Eta" to merging
// And "Eta" stays in ready after the person reloads the board
test('89.4', async ({ page, werk }) => {
  test.setTimeout(180_000)
  const s = await setup(page, werk, {
    tickets: [
      { number: 1, title: 'Builds first', touches: ['h'] },
      { number: 2, title: 'Eta', touches: ['e'] },
    ],
    builders: (gate) => [writes('h.txt', gate('g1')), writes('eta.txt', gate('g2'))],
  })
  // The active run: one build at a time, so Eta waits in ready while ticket 1 builds.
  const run = werk.start(['run', 'map', '--parallel', '1', ...SLOW])
  try {
    await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('the run of map is active', { timeout: 30_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()

    await ticket(page, 2).dragTo(column(page, 'building'))
    await expect(inColumn(page, 'building', 2)).toBeVisible()
    // Ticket 1's build ends, so the one build slot frees for Eta.
    s.open('g1')
    await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 90_000 })
    await expect(inColumn(page, 'building', 2)).toBeVisible()

    await ticket(page, 2).dragTo(column(page, 'ready'))
    await expect(inColumn(page, 'ready', 2)).toBeVisible()
    await expect(ticket(page, 2)).not.toHaveAttribute('data-live', 'true', { timeout: 30_000 })
    const code = await run.exited
    const ev = s.events()
    expect(ev.filter((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'merging')).toEqual([])
    expect(ev.at(-1)).toMatchObject({ type: 'run.ended', payload: { stopped: expect.stringContaining('2 is in ready') } })
    expect(code).toBe(1)
    await page.reload()
    await expect(inColumn(page, 'ready', 2)).toBeVisible()
  } finally {
    s.cleanup()
  }
})

// 89.5
// Scenario: The board refuses every other manual move and has no edit control
// Given an active run with a ready ticket "Theta", a blocked ticket "Iota", and a building ticket "Kappa"
// When the person drags "Theta" into merging
// Then the board refuses the move and "Theta" stays in ready
// When the person drags "Kappa" into done
// Then the board refuses the move and "Kappa" stays in building
// When the person drags "Iota" into building
// Then the board refuses the move and "Iota" stays in blocked
// And no ticket on the board shows a control to edit its text
test('89.5', async ({ page, werk }) => {
  test.setTimeout(180_000)
  const s = await setup(page, werk, {
    tickets: [
      { number: 1, title: 'Kappa', touches: ['k'] },
      { number: 2, title: 'Theta', touches: ['t'] },
      { number: 3, title: 'Iota', touches: ['i'] },
    ],
    extra: [{ type: 'ticket.moved', payload: { number: 3, to: 'blocked', reason: 'blocked_by: waits on a decision' } }],
    builders: (gate) => [writes('k.txt', gate('g1'))],
  })
  werk.start(['run', 'map', '--parallel', '1', ...SLOW])
  try {
    await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('the run of map is active', { timeout: 30_000 })
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 30_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()
    await expect(inColumn(page, 'blocked', 3)).toBeVisible()
    const before = s.events().length

    await ticket(page, 2).dragTo(column(page, 'merging'))
    await expect(page.getByRole('alert')).toContainText('only the merge loop moves a ticket into merging')
    await expect(inColumn(page, 'ready', 2)).toBeVisible()

    await ticket(page, 1).dragTo(column(page, 'done'))
    await expect(page.getByRole('alert')).toContainText('only the merge loop moves a ticket into done')
    await expect(inColumn(page, 'building', 1)).toBeVisible()

    // A blocked ticket is not draggable on this board; the drag starts nothing, and no move is appended.
    const draggable = await ticket(page, 3).getAttribute('draggable')
    await ticket(page, 3).dragTo(column(page, 'building'))
    await page.waitForTimeout(1000)
    await expect(inColumn(page, 'blocked', 3)).toBeVisible()
    const personEvents = s.events().slice(before).filter((e) => e.actor === 'you')
    expect(personEvents).toEqual([])
    expect(draggable).toBe('false')

    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0)
    for (const n of [1, 2, 3]) {
      await ticket(page, n).getByRole('link').click()
      await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(n))
      await expect(page.getByRole('textbox')).toHaveCount(0)
      await expect(page.locator('[contenteditable]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0)
    }
  } finally {
    s.cleanup()
  }
})
