/** Held-out steps 89.x: the person's controls on the board of a plan run over "root". */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'
import {
  activeRun,
  appendBoard,
  boardEvents,
  card,
  column,
  inColumn,
  judges,
  killRuns,
  openBoard,
  planRun,
  readyOrder,
  said,
  ticket,
  writes,
} from './h89-90-lib.ts'

test.afterEach(({ werk }) => killRuns(werk))

test('89.1 nothing builds before the start, and the start builds the tickets in the order the person chose', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const gate = (name: string) => join(werk.dir, '..', name)
  // Given a plan run with two ready tickets, "Alpha" above "Beta", that change the same module
  // And the merge loop is not started
  await planRun(page, werk, [ticket(1, 'Alpha', { touches: ['decision log'] }), ticket(2, 'Beta', { touches: ['decision log'] })])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('beta.txt', [said('Beta.'), { waitFor: gate('beta') }]), writes('alpha.txt', [said('Alpha.'), { waitFor: gate('alpha') }])] },
  })
  await expect.poll(() => readyOrder(page)).toEqual([1, 2])
  // When the person waits on the board
  await page.waitForTimeout(3_000)
  // Then both tickets stay in ready
  await expect.poll(() => readyOrder(page)).toEqual([1, 2])
  await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)
  // When the person drags "Beta" above "Alpha" within ready
  await card(page, 2).dragTo(card(page, 1))
  // And the person reloads the board
  await expect.poll(() => readyOrder(page)).toEqual([2, 1])
  await page.reload()
  // Then "Beta" shows above "Alpha" in ready
  await expect.poll(() => readyOrder(page)).toEqual([2, 1])
  // When the person presses the control that starts the merge loop on the plan run
  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of root' }).click()
  // Then "Beta" moves to building
  await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 20_000 })
  // And "Alpha" stays in ready while "Beta" builds
  await expect(card(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  // And "Beta" later moves through merging to done, and then "Alpha" moves to building
  writeFileSync(gate('beta'), '')
  await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  const moves = boardEvents(werk).filter((e) => e.type === 'ticket.moved')
  expect(moves.filter((e) => e.payload.number === 2).map((e) => e.payload.to)).toEqual(['building', 'merging', 'done'])
  writeFileSync(gate('alpha'), '')
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  // Given a plan run with a ready ticket "Gamma", a blocked ticket "Delta", and a building ticket "Epsilon"
  await planRun(page, werk, [
    ticket(1, 'Gamma'),
    ticket(2, 'Delta'),
    { type: 'ticket.moved', payload: { number: 2, to: 'blocked', reason: 'waits for a decision' } },
    ticket(3, 'Epsilon'),
    { type: 'ticket.moved', payload: { number: 3, to: 'building' } },
  ])
  // When the person looks at the three tickets on the board
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  // Then "Gamma" and "Delta" each show an archive action
  await expect(card(page, 1).getByRole('button', { name: 'Archive ticket 1' })).toBeVisible()
  await expect(card(page, 2).getByRole('button', { name: 'Archive ticket 2' })).toBeVisible()
  // But "Epsilon" shows no archive action
  await expect.soft(card(page, 3).getByRole('button', { name: /^Archive/ })).toHaveCount(0)
  // When the person presses archive on "Gamma"
  await card(page, 1).getByRole('button', { name: 'Archive ticket 1' }).click()
  // Then a confirmation appears that says the ticket can be restored
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/i)
  // When the person confirms
  await dialog.getByRole('button', { name: 'Archive' }).click()
  // Then "Gamma" is gone from the board
  await expect(card(page, 1)).toHaveCount(0)
  // And "Gamma" stays gone after the person reloads the board
  await page.reload()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(card(page, 1)).toHaveCount(0)
  // When the person restores "Gamma" through the restore verb
  werk.cli(['ticket', 'restore', '1'])
  // Then "Gamma" shows again in ready on the board
  await expect(inColumn(page, 'ready', 1)).toHaveText(/Gamma/)
})

test('89.3 a person starts one ready ticket early with the trigger icon, and it goes through the merge queue', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // Given an active run in which a ticket builds and a ready ticket "Zeta" waits
  await planRun(page, werk, [ticket(1, 'First'), ticket(2, 'Zeta')])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('first.txt', [said('First.'), { sleep: 6_000 }]), writes('zeta.txt', [said('Zeta.')])] },
  })
  werk.start(['run', 'root', '--parallel', '1', '--poll-every', '100'])
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
  // When the person presses the trigger icon on "Zeta"
  await card(page, 2).getByRole('button', { name: 'Trigger ticket 2' }).click()
  // Then "Zeta" moves to building
  await expect(inColumn(page, 'building', 2)).toBeVisible()
  // And "Zeta" later moves to merging
  // And "Zeta" then moves to done
  await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 90_000 })
  const zeta = boardEvents(werk).filter((e) => (e.type === 'ticket.moved' || e.type === 'ticket.triggered') && e.payload.number === 2)
  expect(zeta.map((e) => (e.type === 'ticket.triggered' ? 'triggered' : e.payload.to))).toEqual(['triggered', 'merging', 'done'])
})

test('89.4 a person starts a ticket by a drag into building, then stops it by a drag back into ready', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // Given an active run with a ready ticket "Eta"
  await planRun(page, werk, [ticket(1, 'First'), ticket(2, 'Eta')])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('first.txt', [said('First.'), { sleep: 6_000 }]), writes('eta.txt', [said('Eta.'), { waitFor: join(werk.dir, '..', 'never') }])] },
  })
  werk.start(['run', 'root', '--parallel', '1', '--poll-every', '100'])
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
  // When the person drags "Eta" from ready into building
  await card(page, 2).dragTo(column(page, 'building'))
  // Then "Eta" shows in building and its build runs
  await expect(inColumn(page, 'building', 2)).toBeVisible()
  await expect(card(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 60_000 })
  // When the person drags "Eta" from building back into ready
  await card(page, 2).dragTo(column(page, 'ready'))
  // Then "Eta" shows in ready
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
  // And the build of "Eta" stops and does not move "Eta" to merging
  await expect(card(page, 2)).not.toHaveAttribute('data-live', 'true')
  // And "Eta" stays in ready after the person reloads the board
  await page.reload()
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  // Given an active run with a ready ticket "Theta", a blocked ticket "Iota", and a building ticket "Kappa"
  await planRun(page, werk, [
    ticket(1, 'Theta'),
    ticket(2, 'Iota'),
    { type: 'ticket.moved', payload: { number: 2, to: 'blocked', reason: 'waits for a decision' } },
    ticket(3, 'Kappa'),
    { type: 'ticket.moved', payload: { number: 3, to: 'building' } },
  ])
  activeRun(werk)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('the run of root is active')
  // When the person drags "Theta" into merging
  await card(page, 1).dragTo(column(page, 'merging'))
  // Then the board refuses the move and "Theta" stays in ready
  await expect(page.getByRole('alert')).toContainText('merging')
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  // When the person drags "Kappa" into done
  await card(page, 3).dragTo(column(page, 'done'))
  // Then the board refuses the move and "Kappa" stays in building
  await expect(page.getByRole('alert')).toContainText('done')
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  // When the person drags "Iota" into building
  await card(page, 2).dragTo(column(page, 'building'))
  // Then the board refuses the move and "Iota" stays in blocked
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 2)).toHaveCount(0)
  // And no ticket on the board shows a control to edit its text
  const views = page.locator('.views-pane')
  await expect(views.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('[contenteditable]')).toHaveCount(0)
  await expect(page.locator('li[data-ticket]').getByRole('button', { name: /edit/i })).toHaveCount(0)
  void appendBoard
  void openBoard
})
