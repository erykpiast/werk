/** Held-out steps 90.1 - 90.5: a building ticket pulses, and its drawer shows a live log preview. */
import type { Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const result = { event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: 'Done.\n{}' } }

test.beforeEach(async ({ page }) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()
})

test('90.1 a building ticket pulses while its fake builder runs and stops when the pass exits', async ({ page, werk }) => {
  test.setTimeout(60_000)
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working.'), { sleep: 4000 }, result] } } })
  const build = werk.start(['build', '6', '--cap', '1'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  await expect(ticket(page, 6)).toHaveCSS('animation-name', 'pulse')
  await build.exited
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true')
  await expect(ticket(page, 6)).not.toHaveCSS('animation-name', 'pulse')
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  test.setTimeout(90_000)
  const steps = Array.from({ length: 25 }, (_, i) => [said(`event number ${i + 1}`), { sleep: 1000 }]).flat()
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [...steps, result] } } })
  werk.start(['build', '6', '--cap', '1'])
  await column(page, 'building').locator('li[data-ticket="6"]').getByRole('link').click()

  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  const boardBox = (await page.locator('.board').boundingBox())!
  expect((await drawer.boundingBox())!.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height)
  const log = drawer.getByRole('region', { name: 'agent log' })
  const slice = drawer.getByRole('article', { name: 'slice' })
  await expect(log.getByRole('listitem').first()).toHaveText(/event number 1$/)
  expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  const lines = log.locator('ol')
  const first = (await lines.boundingBox())!.height

  await expect(log.getByRole('listitem').nth(1)).toHaveText(/event number 2$/)
  await expect(log.getByRole('listitem').nth(19)).toHaveText(/event number 20$/, { timeout: 30_000 })
  expect((await lines.boundingBox())!.height).toBe(first)
  const scroll = await lines.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(scroll.sh).toBeGreaterThan(scroll.ch)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  test.setTimeout(90_000)
  const exitGate = join(werk.dir, '..', 'exit')
  const mergeGate = join(werk.dir, '..', 'merge-go')
  // Green on the builder's branch; on the merge queue's detached tree, the check waits for a gate.
  const makefile = `test:\n\t@if ! git symbolic-ref -q HEAD >/dev/null; then while [ ! -f ${mergeGate} ]; do sleep 0.1; done; fi\ne2e:\n\t@true\n`
  const reply = (o: unknown) => ({ steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(o)}` } }] })
  werk.scriptAgent({
    steps: [],
    roles: {
      builder: { steps: [said('Writing the Makefile.'), { edit: { path: 'Makefile', content: makefile } }, { waitFor: exitGate }, result] },
      grader: reply({ lines: ['ac-1', '#log', '#fold'].map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
    },
  })
  werk.start(['run', 'map', '--cap', '1'])
  await column(page, 'building').locator('li[data-ticket="6"]').getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer.getByRole('region', { name: 'agent log' })).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')

  writeFileSync(exitGate, '')
  await expect(column(page, 'merging').locator('li[data-ticket="6"]')).toBeVisible({ timeout: 30_000 })
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true')
  await expect(ticket(page, 6)).not.toHaveCSS('animation-name', 'pulse')
  await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
  await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
  await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  writeFileSync(mergeGate, '')
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  test.setTimeout(60_000)
  const checkGate = join(werk.dir, '..', 'check-go')
  const makefile = `test:\n\t@while [ ! -f ${checkGate} ]; do sleep 0.1; done; exit 1\ne2e:\n\t@true\n`
  werk.scriptAgent({
    steps: [],
    roles: {
      builder: [
        { steps: [said('First pass.'), { sleep: 1500 }, { edit: { path: 'Makefile', content: makefile } }], exit: 1 },
        { steps: [said('Second pass.'), result] },
      ],
    },
  })
  werk.start(['build', '6', '--cap', '2'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')
  await expect(ticket(page, 6)).toHaveCSS('animation-name', 'pulse')
  // The first pass exits with a failure; its check now waits, so the next attempt has not started.
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true', { timeout: 10_000 })
  await expect(ticket(page, 6)).not.toHaveCSS('animation-name', 'pulse')
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  writeFileSync(checkGate, '')
})

test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  test.setTimeout(60_000)
  const never = join(werk.dir, '..', 'never')
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working for a long time.'), { waitFor: never }, result] } } })
  // A unique flag value lets the test find the build process, as a person finds their terminal.
  const build = werk.start(['build', '6', '--cap', '1', '--check-timeout', '7654321'])
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')

  // The person presses Ctrl-C in the terminal of the build.
  spawnSync('pkill', ['-INT', '-f', 'check-timeout 7654321'])
  await build.exited
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true', { timeout: 10_000 })

  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible({ timeout: 10_000 })
  await column(page, 'ready').locator('li[data-ticket="6"]').getByRole('link').click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', '6')
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  writeFileSync(never, '')
})

test('90.5b (diagnostic) a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  test.setTimeout(60_000)
  const never = join(werk.dir, '..', 'never')
  werk.scriptAgent({ steps: [], roles: { builder: { steps: [said('Working for a long time.'), { waitFor: never }, result] } } })
  // A unique flag value lets the test find the build process, as a person finds their terminal.
  const build = werk.start(['build', '6', '--cap', '1', '--check-timeout', '7654322'])
  await expect(ticket(page, 6)).toHaveAttribute('data-live', 'true')

  // The person presses Ctrl-C in the terminal of the build.
  spawnSync('pkill', ['-INT', '-f', 'check-timeout 7654322'])
  spawnSync('pkill', ['-f', 'fake-agent.ts'])
  await build.exited
  await expect(ticket(page, 6)).not.toHaveAttribute('data-live', 'true', { timeout: 10_000 })

  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible({ timeout: 10_000 })
  await column(page, 'ready').locator('li[data-ticket="6"]').getByRole('link').click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', '6')
  await expect(page.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  writeFileSync(never, '')
})
