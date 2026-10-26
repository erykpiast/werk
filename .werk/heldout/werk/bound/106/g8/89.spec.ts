/** Held-out steps 89.1 to 89.5: the person's controls on the board. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'
import { alive, board, boardEvents, column, gate, inColumn, judges, movesOf, numbers, open, openBoard, release, reply, ROOT, said, ticket } from './setup.ts'

test.setTimeout(150_000)

test('89.1 nothing builds before the start, and the start builds the tickets in the order the person chose', async ({ page, werk }) => {
  const beta = gate(werk, 'beta')
  const alpha = gate(werk, 'alpha')
  try {
    // Alpha (1) above Beta (2), both change the same module.
    board(werk, [
      { number: 1, title: 'Alpha', touches: ['decision log'] },
      { number: 2, title: 'Beta', touches: ['decision log'] },
    ])
    // The first build launch is Beta's (if the order holds), the second Alpha's.
    werk.scriptAgent({
      steps: [],
      roles: {
        ...judges(),
        builder: [
          { steps: [said('Building the first ticket.'), { waitFor: beta }, { edit: { path: 'first.txt', content: 'first\n' } }, ...reply().steps] },
          { steps: [said('Building the second ticket.'), { waitFor: alpha }, { edit: { path: 'second.txt', content: 'second\n' } }, ...reply().steps] },
        ],
      },
    })
    await openBoard(page)
    await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])

    // The person waits on the board.
    await page.waitForTimeout(3_000)
    expect(await numbers(page, 'ready')).toEqual([1, 2])
    await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)

    await ticket(page, 2).dragTo(ticket(page, 1))
    await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])
    await page.reload()
    await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])

    await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
    await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 20_000 })
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    // Alpha stays in ready while Beta builds.
    await page.waitForTimeout(2_000)
    await expect(inColumn(page, 'ready', 1)).toBeVisible()
    expect(movesOf(werk, 1)).toEqual([])

    open(beta)
    await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
    expect(movesOf(werk, 2)).toEqual(['building', 'merging', 'done'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    // Alpha moved to building only after Beta was done.
    const ev = boardEvents(werk)
    const betaDone = ev.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'done')
    const alphaBuild = ev.findIndex((e) => e.type === 'ticket.moved' && e.payload.number === 1 && e.payload.to === 'building')
    expect(alphaBuild).toBeGreaterThan(betaDone)
  } finally {
    await release(werk, [beta, alpha])
  }
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  board(
    werk,
    [
      { number: 1, title: 'Gamma' },
      { number: 2, title: 'Delta' },
      { number: 3, title: 'Epsilon' },
    ],
    [
      { type: 'ticket.moved', payload: { number: 2, to: 'blocked', reason: 'blocked_by: waits for an agent' } },
      { type: 'ticket.moved', payload: { number: 3, to: 'building' } },
    ],
  )
  await openBoard(page)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 3)).toBeVisible()

  await expect.soft(ticket(page, 1).getByRole('button', { name: /^Archive/ })).toBeVisible()
  await expect.soft(ticket(page, 2).getByRole('button', { name: /^Archive/ })).toBeVisible()
  // Epsilon is building: the step says it shows no archive action.
  await expect.soft(ticket(page, 3).getByRole('button', { name: /^Archive/ })).toHaveCount(0)

  await ticket(page, 1).getByRole('button', { name: /^Archive/ }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 1)).toHaveCount(0)
  await page.reload()
  await expect(inColumn(page, 'ready', 1)).toHaveCount(0)
  await expect(ticket(page, 1)).toHaveCount(0)

  werk.cli(['ticket', 'restore', '1'])
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'ready', 1)).toContainText('Gamma')
})

test('89.3 a person starts one ready ticket early with the trigger icon, and it goes through the merge queue', async ({ page, werk }) => {
  const zeta = gate(werk, 'zeta')
  try {
    // Ticket 1 builds first. Zeta shares its module, so it waits in ready.
    board(werk, [
      { number: 1, title: 'Builds first', touches: ['decision log'] },
      { number: 2, title: 'Zeta', touches: ['decision log'] },
    ])
    werk.scriptAgent({
      steps: [],
      roles: {
        ...judges(),
        builder: [
          { steps: [said('Building ticket 1.'), { sleep: 6_000 }, { edit: { path: 'one.txt', content: 'one\n' } }, ...reply().steps] },
          { steps: [said('Building Zeta.'), { waitFor: zeta }, { edit: { path: 'zeta.txt', content: 'zeta\n' } }, ...reply().steps] },
        ],
      },
    })
    await openBoard(page)
    await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()

    await ticket(page, 2).getByRole('button', { name: 'Trigger ticket 2' }).click()
    await expect(inColumn(page, 'building', 2)).toBeVisible()
    open(zeta)
    await expect.poll(() => movesOf(werk, 2), { timeout: 90_000 }).toContain('merging')
    await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
    expect(boardEvents(werk).some((e) => e.type === 'ticket.triggered' && e.payload.number === 2)).toBe(true)
    expect(movesOf(werk, 2).slice(-2)).toEqual(['merging', 'done'])
  } finally {
    await release(werk, [zeta])
  }
})

test('89.4 a person starts a ticket by a drag into building, then stops it by a drag back into ready', async ({ page, werk }) => {
  const eta = gate(werk, 'eta')
  try {
    // Ticket 1 builds for a few seconds. Eta shares its module, so the run leaves it in ready.
    board(werk, [
      { number: 1, title: 'Builds first', touches: ['decision log'] },
      { number: 2, title: 'Eta', touches: ['decision log'] },
    ])
    werk.scriptAgent({
      steps: [],
      roles: {
        ...judges(),
        builder: [
          { steps: [said('Building ticket 1.'), { sleep: 4_000 }, { edit: { path: 'one.txt', content: 'one\n' } }, ...reply().steps] },
          { steps: [said('Building Eta.'), { waitFor: eta }, { edit: { path: 'eta.txt', content: 'eta\n' } }, ...reply().steps] },
        ],
      },
    })
    await openBoard(page)
    await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
    await expect(page.getByRole('list', { name: 'plan runs' })).toContainText(`the run of ${ROOT} is active`, { timeout: 20_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()

    await ticket(page, 2).dragTo(column(page, 'building'))
    await expect(inColumn(page, 'building', 2)).toBeVisible()
    // Its build runs: the card pulses once its builder session runs.
    await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 60_000 })
    const { pid } = JSON.parse(readFileSync(join(werk.dir, '.werk', 'sessions', '2.json'), 'utf8')) as { pid: number }

    await ticket(page, 2).dragTo(column(page, 'ready'))
    const refusal = page.getByRole('alert')
    await expect.soft(inColumn(page, 'ready', 2)).toBeVisible()
    if (await refusal.count()) console.log(`89.4 alert: ${await refusal.textContent()}`)
    await expect.soft(ticket(page, 2)).not.toHaveAttribute('data-live', 'true')
    expect.soft(alive(pid)).toBe(false)
    expect.soft(movesOf(werk, 2)).not.toContain('merging')
    await page.reload()
    await expect.soft(inColumn(page, 'ready', 2)).toBeVisible()
    console.log(`89.4 columns after reload: ready=${JSON.stringify(await numbers(page, 'ready'))} building=${JSON.stringify(await numbers(page, 'building'))}`)
  } finally {
    await release(werk, [eta])
  }
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  const kappa = gate(werk, 'kappa')
  try {
    // Kappa (1) builds and waits. Theta (2) shares its module, so it stays in ready. Iota (3) is blocked.
    board(
      werk,
      [
        { number: 1, title: 'Kappa', touches: ['decision log'] },
        { number: 2, title: 'Theta', touches: ['decision log'] },
        { number: 3, title: 'Iota', touches: ['map view'] },
      ],
      [{ type: 'ticket.moved', payload: { number: 3, to: 'blocked', reason: 'blocked_by: waits for an agent' } }],
    )
    werk.scriptAgent({
      steps: [],
      roles: { ...judges(), builder: [{ steps: [said('Building Kappa.'), { waitFor: kappa }, ...reply().steps] }] },
    })
    await openBoard(page)
    await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await expect(inColumn(page, 'ready', 2)).toBeVisible()
    await expect(inColumn(page, 'blocked', 3)).toBeVisible()

    await ticket(page, 2).dragTo(column(page, 'merging'))
    await expect.soft(page.getByRole('alert')).toBeVisible()
    await expect.soft(inColumn(page, 'ready', 2)).toBeVisible()

    await ticket(page, 1).dragTo(column(page, 'done'))
    await expect.soft(page.getByRole('alert')).toBeVisible()
    await expect.soft(inColumn(page, 'building', 1)).toBeVisible()

    const before = boardEvents(werk).filter((e) => e.payload.number === 3).length
    await ticket(page, 3).dragTo(column(page, 'building'))
    await page.waitForTimeout(1_000)
    await expect.soft(inColumn(page, 'blocked', 3)).toBeVisible()
    expect.soft(boardEvents(werk).filter((e) => e.payload.number === 3).length).toBe(before)

    expect.soft(boardEvents(werk).some((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'merging')).toBe(false)
    expect.soft(boardEvents(werk).some((e) => e.type === 'ticket.moved' && e.payload.number === 1 && e.payload.to === 'done')).toBe(false)

    // No control edits a ticket's text: on the board, and in a ticket's drawer.
    for (const n of [1, 2, 3]) {
      await ticket(page, n).getByRole('link').click()
      const views = page.locator('.views-pane')
      await expect.soft(views.getByRole('textbox')).toHaveCount(0)
      await expect.soft(views.locator('[contenteditable]')).toHaveCount(0)
      await expect.soft(views.getByRole('button', { name: /edit/i })).toHaveCount(0)
    }
  } finally {
    await release(werk, [kappa])
  }
})
