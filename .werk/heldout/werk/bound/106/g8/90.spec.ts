/** Held-out steps 90.1 to 90.5: the pulse of a building ticket and the drawer's log preview. */
import { expect, test } from '../../e2e/harness.ts'
import { board, column, gate, inColumn, judges, movesOf, open, openBoard, release, reply, said, ticket } from './setup.ts'

test.setTimeout(150_000)

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  const done = gate(werk, 'unused')
  try {
    board(werk, [{ number: 1, title: 'Pulse me' }])
    // The fake builder runs for a few seconds and then exits.
    werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { sleep: 4_000 }, ...reply().steps] } } })
    await openBoard(page)
    await expect(inColumn(page, 'ready', 1)).toBeVisible()

    const build = werk.start(['build', '1', '--cap', '1'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
    await expect(ticket(page, 1)).toHaveCSS('animation-name', 'pulse')

    // The pass exits after its few seconds.
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
    await expect(ticket(page, 1)).not.toHaveCSS('animation-name', 'pulse')
    console.log(`90.1 build exit: ${await build.exited}`)
  } finally {
    await release(werk, [done])
  }
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  try {
    board(werk, [{ number: 1, title: 'Log me' }])
    // A new log event every second.
    const steps = Array.from({ length: 16 }, (_, i) => [said(`event ${i + 1}`), { sleep: 1_000 }]).flat()
    werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [...steps, ...reply().steps] } } })
    await openBoard(page)
    werk.start(['build', '1', '--cap', '1'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await inColumn(page, 'building', 1).getByRole('link').click()

    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer).toBeVisible()
    const boardBox = (await page.locator('.board').boundingBox())!
    expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height)

    const log = drawer.getByRole('region', { name: 'agent log' })
    await expect(log).toBeVisible()
    const slice = drawer.getByRole('article', { name: 'slice' })
    expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)

    const lines = log.getByRole('listitem')
    await expect(lines.first()).toContainText('event 1')
    const height = (await log.boundingBox())!.height
    const count = await lines.count()
    // The next event comes with no reload.
    await expect.poll(() => lines.count(), { timeout: 5_000 }).toBeGreaterThan(count)
    await expect(log).toContainText(`event ${count + 1}`)

    // Many events later, the log is the same height and its content scrolls.
    await expect(log).toContainText('event 14', { timeout: 20_000 })
    expect((await log.boundingBox())!.height).toBe(height)
    const viewport = log.locator('ol')
    const { scrollHeight, clientHeight } = await viewport.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    expect(scrollHeight).toBeGreaterThan(clientHeight)
  } finally {
    await release(werk, [])
  }
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  const exit = gate(werk, 'exit')
  const merge = gate(werk, 'merge')
  try {
    // The check waits for a gate on the merge queue's tree (a detached HEAD), so merging lasts until the test opens it.
    board(werk, [{ number: 1, title: 'Merge me' }], [], `\t@if ! git symbolic-ref -q HEAD >/dev/null; then while [ ! -f ${merge} ]; do sleep 0.2; done; fi`)
    werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { waitFor: exit }, { edit: { path: 'a.txt', content: 'a\n' } }, ...reply().steps] } } })
    await openBoard(page)
    werk.start(['run', 'werk'])
    await expect(inColumn(page, 'building', 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
    await inColumn(page, 'building', 1).getByRole('link').click()
    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer.getByRole('region', { name: 'agent log' })).toBeVisible()

    open(exit)
    await expect(inColumn(page, 'merging', 1)).toBeVisible({ timeout: 60_000 })
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
    await expect(drawer).toHaveAttribute('data-ticket', '1')
    await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
    await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
    await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  } finally {
    await release(werk, [exit, merge])
  }
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  const first = gate(werk, 'first')
  const checks = gate(werk, 'checks')
  const second = gate(werk, 'second')
  try {
    // The check waits for a gate, then passes only when the second pass wrote ok.txt.
    board(werk, [{ number: 1, title: 'Retry me' }], [], `\t@while [ ! -f ${checks} ]; do sleep 0.2; done; test -f ok.txt`)
    werk.scriptAgent({
      steps: [],
      roles: {
        ...judges(),
        builder: [
          { steps: [said('First pass.'), { waitFor: first }, { event: { type: 'result', subtype: 'error_during_execution', is_error: true } }], exit: 1 },
          { steps: [said('Second pass.'), { waitFor: second }, { edit: { path: 'ok.txt', content: 'ok\n' } }, ...reply().steps] },
        ],
      },
    })
    await openBoard(page)
    werk.start(['build', '1', '--cap', '2'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')

    open(first)
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
    await expect(inColumn(page, 'building', 1)).toBeVisible()
    await page.waitForTimeout(1_000)
    await expect(inColumn(page, 'building', 1)).toBeVisible()
    await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
    expect(movesOf(werk, 1)).toEqual(['building'])
  } finally {
    await release(werk, [first, checks, second])
  }
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  const never = gate(werk, 'never')
  try {
    board(werk, [{ number: 1, title: 'Stop me' }])
    werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { waitFor: never }, ...reply().steps] } } })
    await openBoard(page)
    werk.start(['build', '1', '--cap', '1'])
    await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
    await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')

    // The person stops the build by hand: a drag of the card back to ready.
    await ticket(page, 1).dragTo(column(page, 'ready'))
    const alert = page.getByRole('alert')
    if (await alert.count()) console.log(`90.5 alert: ${await alert.textContent()}`)
    await expect.soft(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
    await expect.soft(inColumn(page, 'ready', 1)).toBeVisible()
    await ticket(page, 1).getByRole('link').click()
    await expect.soft(page.getByRole('region', { name: 'drawer' }).getByRole('region', { name: 'agent log' })).toHaveCount(0)
  } finally {
    await release(werk, [never])
  }
})
