/** Held-out step 83.5: the board shows a building ticket and its retry count. */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

const result = (text?: string) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, ...(text !== undefined && { result: text }) } })
const reply = (object: unknown) => ({ steps: [result(`Done.\n${JSON.stringify(object)}`)] })

test('83.5 the board shows the ticket in building with its retry count', async ({ page, werk }) => {
  // One ready ticket with one check, and no blocker.
  const planned = {
    seq: 100,
    at: new Date().toISOString(),
    actor: 'agent',
    type: 'ticket.planned',
    payload: {
      number: 7,
      title: 'Write the done file',
      cites: [],
      blockedBy: [],
      stories: [],
      touches: ['done file'],
      checks: ['test -f done.txt'],
      brief: '## What to build\n\nWrite done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
    },
  }
  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), JSON.stringify(planned) + '\n')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(column(page, 'ready').locator('li[data-ticket="7"]')).toBeVisible()

  const release = join(werk.dir, '..', 'release-pass-1')
  werk.scriptAgent({
    steps: [],
    roles: {
      builder: [
        { steps: [{ waitFor: release }, { edit: { path: 'work.txt', content: '1\n' } }, result()] },
        { steps: [{ edit: { path: 'work.txt', content: '2\n' } }, result()] },
        { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result()] },
      ],
      grader: reply({ lines: [{ id: 'ac-1', score: 4, gap: 'none' }] }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
    },
  })
  const build = werk.start(['build', '7'])

  // The board shows the ticket in the building column.
  await expect(column(page, 'building').locator('li[data-ticket="7"]')).toBeVisible({ timeout: 15_000 })
  writeFileSync(release, '')

  expect(await build.exited).toBe(0)
  // The board shows the retry count of the ticket as 2 when the build ends.
  await expect(ticket(page, 7).locator('[data-badge="retries"]')).toHaveText('↻ 2')
})
