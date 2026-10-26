import { expect, test } from '../../e2e/harness.ts'
import {
  builds,
  card,
  column,
  gate,
  inColumn,
  killAll,
  moved,
  movesOf,
  numbersIn,
  open,
  openBoard,
  planned,
  prepareRepo,
  ROOT,
  said,
  scriptRun,
  writeBoard,
} from './helpers.ts'

test.afterEach(async ({ werk }) => {
  killAll(werk)
  await new Promise((r) => setTimeout(r, 1_000))
})

test('89.1 nothing builds before the start, and the start builds in the order the person chose', async ({ page, werk }) => {
  test.setTimeout(120_000)
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'Alpha', touches: ['shared module'] }), planned({ number: 2, title: 'Beta', touches: ['shared module'] })])
  scriptRun(werk, [builds('beta.txt', { waitFor: gate(werk, 'beta-go') }), builds('alpha.txt')])
  await openBoard(page)
  await expect.poll(() => numbersIn(page, 'ready')).toEqual([1, 2])

  // The person waits on the board.
  await page.waitForTimeout(4_000)
  expect(await numbersIn(page, 'ready')).toEqual([1, 2])
  await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)
  expect(werk.agentLaunches()).toHaveLength(0)

  await card(page, 2).dragTo(card(page, 1))
  await expect.poll(() => numbersIn(page, 'ready')).toEqual([2, 1])
  await page.reload()
  await expect.poll(() => numbersIn(page, 'ready')).toEqual([2, 1])

  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
  await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 20_000 })
  await expect(card(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()

  open(werk, 'beta-go')
  await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 40_000 })
  expect(movesOf(werk, 2)).toEqual(['building', 'merging', 'done'])
  await expect.poll(() => movesOf(werk, 1), { timeout: 20_000 }).toContain('building')
  const order = (await import('./helpers.ts')).boardEvents(werk).flatMap((e) =>
    e.type === 'ticket.moved' ? [`${e.payload.number}:${e.payload.to}`] : [],
  )
  expect(order.indexOf('1:building')).toBeGreaterThan(order.indexOf('2:done'))
  await expect(page.locator('li[data-ticket="1"]')).toBeVisible()
  await expect.poll(() => (order.length, movesOf(werk, 1)), { timeout: 40_000 }).toContain('done')
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  writeBoard(werk, [
    planned({ number: 1, title: 'Gamma' }),
    planned({ number: 2, title: 'Delta' }),
    planned({ number: 3, title: 'Epsilon' }),
    moved(2, 'blocked', 'it waits for a decision'),
    moved(3, 'building'),
  ])
  await openBoard(page)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  await expect(card(page, 1).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(card(page, 2).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(card(page, 3).getByRole('button', { name: /archive/i })).toHaveCount(0)

  await card(page, 1).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 1)).toHaveCount(0)
  await expect(page.locator('.board')).not.toContainText('Gamma')
  await page.reload()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(card(page, 1)).toHaveCount(0)
  await expect(page.locator('.board')).not.toContainText('Gamma')

  werk.cli(['ticket', 'restore', '1'])
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'ready', 1)).toContainText('Gamma')
})

test('89.3 the trigger icon starts one ready ticket early, and it goes through the merge queue', async ({ page, werk }) => {
  test.setTimeout(120_000)
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'First' }), planned({ number: 2, title: 'Zeta' })])
  scriptRun(werk, [builds('first.txt', { waitFor: gate(werk, 'first-go') }), builds('zeta.txt')])
  werk.start(['run', ROOT, '--parallel', '1'])
  await openBoard(page)
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await expect(inColumn(page, 'ready', 2)).toBeVisible()

  await card(page, 2).getByRole('button', { name: /trigger/i }).click()
  await expect(inColumn(page, 'building', 2)).toBeVisible()
  open(werk, 'first-go')
  await expect.poll(() => movesOf(werk, 2), { timeout: 40_000 }).toContain('merging')
  await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 40_000 })
  const moves = movesOf(werk, 2)
  expect(moves.indexOf('merging')).toBeGreaterThan(-1)
  expect(moves.indexOf('done')).toBeGreaterThan(moves.indexOf('merging'))
})

test('89.4 a drag into building starts a ticket, and a drag back into ready stops it', async ({ page, werk }) => {
  test.setTimeout(120_000)
  prepareRepo(werk)
  writeBoard(werk, [planned({ number: 1, title: 'First' }), planned({ number: 2, title: 'Eta' })])
  scriptRun(werk, [builds('first.txt', { waitFor: gate(werk, 'first-go') }), builds('eta.txt', { waitFor: gate(werk, 'eta-go') })])
  werk.start(['run', ROOT, '--parallel', '1'])
  await openBoard(page)
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })

  await card(page, 2).dragTo(column(page, 'building'))
  await expect(inColumn(page, 'building', 2)).toBeVisible()
  open(werk, 'first-go')
  // Its build runs: the builder of Eta starts and the card pulses.
  await expect(card(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 40_000 })

  await card(page, 2).dragTo(column(page, 'ready'))
  await expect(inColumn(page, 'ready', 2)).toBeVisible({ timeout: 5_000 })
  await expect(card(page, 2)).not.toHaveAttribute('data-live', 'true')
  open(werk, 'eta-go')
  await page.waitForTimeout(5_000)
  expect(movesOf(werk, 2)).not.toContain('merging')
  await page.reload()
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  test.setTimeout(120_000)
  prepareRepo(werk)
  writeBoard(werk, [
    planned({ number: 1, title: 'Kappa' }),
    planned({ number: 2, title: 'Theta' }),
    planned({ number: 3, title: 'Iota' }),
    moved(3, 'blocked', 'it waits for a decision'),
  ])
  scriptRun(werk, [builds('kappa.txt', { waitFor: gate(werk, 'never') })])
  werk.start(['run', ROOT, '--parallel', '1'])
  await openBoard(page)
  await expect(card(page, 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
  await expect(inColumn(page, 'blocked', 3)).toBeVisible()

  await card(page, 2).dragTo(column(page, 'merging'))
  await expect(page.getByRole('alert')).toContainText('merging')
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
  await expect(inColumn(page, 'merging', 2)).toHaveCount(0)

  await card(page, 1).dragTo(column(page, 'done'))
  await expect(page.getByRole('alert')).toContainText('done')
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await expect(inColumn(page, 'done', 1)).toHaveCount(0)

  await card(page, 3).dragTo(column(page, 'building'))
  await page.waitForTimeout(1_000)
  await expect(inColumn(page, 'blocked', 3)).toBeVisible()
  await expect(inColumn(page, 'building', 3)).toHaveCount(0)
  expect(movesOf(werk, 3)).toEqual(['blocked'])

  const views = page.locator('.views-pane')
  await expect(views.getByRole('textbox')).toHaveCount(0)
  await expect(views.locator('[contenteditable]')).toHaveCount(0)
  await expect(views.getByRole('button', { name: /edit/i })).toHaveCount(0)
  for (const n of [1, 2, 3]) {
    await card(page, n).getByRole('link').first().click()
    await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(n))
    await expect(views.getByRole('textbox')).toHaveCount(0)
    await expect(views.locator('[contenteditable]')).toHaveCount(0)
    await expect(views.getByRole('button', { name: /edit/i })).toHaveCount(0)
  }
  void said
})
