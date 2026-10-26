/** Held-out step 83.5: the board shows a building ticket and its retry count. */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../e2e/harness.ts'

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const result = { event: { type: 'result', subtype: 'success', total_cost_usd: 0.1, num_turns: 1 } }
const judge = (object: unknown) => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})

// Scenario: The board shows the ticket in building with its retry count
// Given a project repository with one ready ticket shown in the ready column of the board
// And the builder agent leaves the check red on its first two passes and makes it green on its third pass
// When the person starts the build of the ticket
// Then the board shows the ticket in the building column
// And the board shows the retry count of the ticket as 2 when the build ends
test('83.5 the board shows the building ticket with a retry count of 2', async ({ page, werk }) => {
  // Ticket 6 of the fixture is ready, with the checks `make test` and `make e2e`.
  writeFileSync(join(werk.dir, 'Makefile'), 'test:\n\t@test -f done.txt\ne2e:\n\t@true\n')
  spawnSync('git', ['add', 'Makefile'], { cwd: werk.dir })
  spawnSync('git', ['commit', '--quiet', '-m', 'Add the checks'], { cwd: werk.dir })
  const working = { steps: [{ edit: { path: 'work.txt', content: 'x\n' } }, result] }
  const finishing = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result] }
  const ids = ['ac-1', '#log', '#fold', '#werk', '#map']
  const reviewers = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, judge({ findings: [] })])
  werk.scriptAgent({
    steps: [],
    roles: { builder: [working, working, finishing], grader: judge({ lines: ids.map((id) => ({ id, score: 4, gap: 'none' })) }), ...Object.fromEntries(reviewers) },
  })

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(column(page, 'ready').locator('li[data-ticket="6"]')).toBeVisible()

  const build = werk.start(['build', '6'])
  await expect(column(page, 'building').locator('li[data-ticket="6"]')).toBeVisible()
  expect(await build.exited).toBe(0)
  await expect(page.locator('li[data-ticket="6"] [data-badge="retries"]')).toHaveText(/2/)
})
