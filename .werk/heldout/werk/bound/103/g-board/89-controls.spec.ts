/** Held-out steps 89.1 - 89.5: the person's controls on the board. */
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { appendBoard, boardEvents, column, inColumn, judgesAndHeldout, killRuns, moved, numbers, openBoard, planned, replaceBoard, result, said, ticket } from './helpers.ts'

const MERGE_SLOW = 'git symbolic-ref -q HEAD >/dev/null || sleep 3'
const builderHolds = (ms: number, file: string) => ({ steps: [{ edit: { path: file, content: `${file}\n` } }, said('Building.'), { sleep: ms }, result] })

test('89.1 nothing builds before the start, and the start builds in the order the person chose', async ({ page, werk }) => {
  test.setTimeout(180_000)
  replaceBoard(
    werk.dir,
    planned({ number: 1, title: 'Alpha', root: 'pr', touches: ['decision log'], checks: [MERGE_SLOW] }),
    planned({ number: 2, title: 'Beta', root: 'pr', touches: ['decision log'], checks: [MERGE_SLOW] }),
  )
  werk.scriptAgent({ steps: [], roles: { builder: [builderHolds(4_000, 'first.txt'), builderHolds(1_000, 'second.txt')], ...judgesAndHeldout([1, 2]) } })
  await openBoard(page, werk)
  try {
    await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])
    await page.waitForTimeout(3_000)
    await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])
    await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)

    await ticket(page, 2).dragTo(ticket(page, 1))
    await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])
    await page.reload()
    await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])

    await page.getByRole('button', { name: /start the run of pr/i }).click()
    await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 20_000 })
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
    const moves = boardEvents(werk.dir).filter((e) => e.type === 'ticket.moved').map((e) => `${e.payload.number}:${e.payload.to}`)
    expect(moves.slice(0, 3)).toEqual(['2:building', '2:merging', '2:done'])
    await expect.poll(() => boardEvents(werk.dir).some((e) => e.type === 'ticket.moved' && e.payload.number === 1 && e.payload.to === 'building'), { timeout: 30_000 }).toBe(true)
    const all = boardEvents(werk.dir).filter((e) => e.type === 'ticket.moved').map((e) => `${e.payload.number}:${e.payload.to}`)
    expect(all.indexOf('1:building')).toBeGreaterThan(all.indexOf('2:done'))
  } finally {
    killRuns(werk)
  }
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  replaceBoard(
    werk.dir,
    planned({ number: 1, title: 'Gamma' }),
    planned({ number: 2, title: 'Delta' }),
    planned({ number: 3, title: 'Epsilon' }),
    moved(2, 'blocked', 'blocked_by: waits on something'),
    moved(3, 'building'),
  )
  await openBoard(page, werk)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  await expect(ticket(page, 1).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(ticket(page, 2).getByRole('button', { name: /archive/i })).toBeVisible()
  // The step: Epsilon, a building ticket, shows no archive action.
  await expect.soft(ticket(page, 3).getByRole('button', { name: /archive/i })).toHaveCount(0)

  await ticket(page, 1).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 1)).toHaveCount(0)
  await page.reload()
  await expect(inColumn(page, 'ready', 2).or(inColumn(page, 'blocked', 2))).toBeVisible()
  await expect(ticket(page, 1)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '1'])
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(ticket(page, 1)).toContainText('Gamma')
})

test('89.3 the trigger icon starts a ready ticket early, and it goes through the merge queue', async ({ page, werk }) => {
  test.setTimeout(120_000)
  replaceBoard(
    werk.dir,
    planned({ number: 1, title: 'First', root: 'tr', checks: [MERGE_SLOW] }),
    planned({ number: 2, title: 'Zeta', root: 'tr', checks: [MERGE_SLOW] }),
  )
  werk.scriptAgent({ steps: [], roles: { builder: [builderHolds(5_000, 'first.txt'), builderHolds(1_000, 'zeta.txt')], ...judgesAndHeldout([1, 2]) } })
  await openBoard(page, werk)
  try {
    werk.start(['run', 'tr', '--parallel', '1', '--poll-every', '100'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()
    await ticket(page, 2).getByRole('button', { name: /trigger/i }).click()
    await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 10_000 })
    await expect(inColumn(page, 'merging', 2)).toBeVisible({ timeout: 60_000 })
    await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 30_000 })
  } finally {
    killRuns(werk)
  }
})

test('89.4 a drag into building starts a ticket, and a drag back into ready stops it', async ({ page, werk }) => {
  test.setTimeout(120_000)
  replaceBoard(werk.dir, planned({ number: 1, title: 'First', root: 'dr' }), planned({ number: 2, title: 'Eta', root: 'dr' }))
  werk.scriptAgent({
    steps: [],
    roles: { builder: [builderHolds(4_000, 'first.txt'), { steps: [said('Eta builds.'), { waitFor: join(werk.dir, '..', 'never') }] }], ...judgesAndHeldout([1, 2]) },
  })
  await openBoard(page, werk)
  try {
    werk.start(['run', 'dr', '--parallel', '1', '--poll-every', '100'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await ticket(page, 2).dragTo(column(page, 'building'))
    await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 10_000 })
    await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 60_000 })

    await ticket(page, 2).dragTo(column(page, 'ready'))
    await expect(inColumn(page, 'ready', 2)).toBeVisible({ timeout: 10_000 })
    await expect(ticket(page, 2)).not.toHaveAttribute('data-live', /.*/)
    await page.waitForTimeout(3_000)
    expect(boardEvents(werk.dir).some((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'merging')).toBe(false)
    await page.reload()
    await expect(inColumn(page, 'ready', 2)).toBeVisible()
  } finally {
    killRuns(werk)
  }
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  replaceBoard(
    werk.dir,
    planned({ number: 1, title: 'Theta', root: 'mv' }),
    planned({ number: 2, title: 'Iota', root: 'mv' }),
    planned({ number: 3, title: 'Kappa', root: 'mv' }),
    moved(2, 'blocked', 'blocked_by: waits'),
    moved(3, 'building'),
  )
  // An active run of mv: this test's process stands in for the merge loop.
  appendBoard(werk.dir, { type: 'run.started', payload: { root: 'mv', pid: process.pid } })
  await openBoard(page, werk)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('active')

  await ticket(page, 1).dragTo(column(page, 'merging'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'merging', 1)).toHaveCount(0)

  await ticket(page, 3).dragTo(column(page, 'done'))
  await expect(page.getByRole('alert')).toContainText('done')
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  await expect(inColumn(page, 'done', 3)).toHaveCount(0)

  await ticket(page, 2).dragTo(column(page, 'building'))
  await page.waitForTimeout(1_000)
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 2)).toHaveCount(0)

  const views = page.locator('.views-pane')
  await expect(views.getByRole('textbox')).toHaveCount(0)
  await expect(views.locator('[contenteditable]')).toHaveCount(0)
  await expect(views.getByRole('button', { name: /edit/i })).toHaveCount(0)
})
