/** Held-out steps 87.2 and 87.4: the merge loop as the person sees it on the board. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../e2e/harness.ts'
import type { FakeReply, FakeStep } from '../src/test/fake-agent.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

const result = (object: unknown = {}): FakeStep => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})
const reply = (object: unknown): FakeReply => ({ steps: [result(object)] })
const writes = (path: string, before: FakeStep[] = []): FakeReply => ({ steps: [...before, { edit: { path, content: `${path}\n` } }, result()] })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: [{ id: 'ac-1', score: 4, gap: 'none' }] }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const author = reply({ steps: [{ text: 'Given the product is installed\nWhen the user opens it\nThen the user sees it work' }] })
const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })

function git(dir: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  return r.stdout.trim()
}

/** A Makefile check and the subtree hx's tickets, planned in ready on the board. */
function plan(dir: string, makefile: string, numbers: number[]) {
  writeFileSync(join(dir, 'Makefile'), makefile)
  git(dir, 'add', 'Makefile')
  git(dir, 'commit', '--quiet', '-m', 'Add the check')
  for (const number of numbers) {
    const payload = {
      number,
      title: `Ticket ${number}`,
      cites: [],
      blockedBy: [],
      stories: [],
      touches: [`module ${number}`],
      checks: ['make check'],
      brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
      root: 'hx',
    }
    appendFileSync(join(dir, '.werk', 'board.jsonl'), JSON.stringify({ seq: 0, at: '2026-10-22T00:00:00.000Z', actor: 'agent', type: 'ticket.planned', payload }) + '\n')
  }
}

const openBoard = async (page: Page) => {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

test('87.2 a ticket that is red on the merged tree goes back to building and the main line stays where it was', async ({ page, werk }) => {
  plan(werk.dir, 'check:\n\t@if test -f a.txt && test -f b.txt; then echo BOTH-FILES-RED-MARK; exit 1; fi\n', [7, 8])
  // Ticket 8 is built alone, next to 7, and reaches merging after 7 has merged.
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('a.txt'), writes('b.txt', [{ sleep: 3000 }])], 'heldout-author': author, 'heldout-binder': binder({ '7.1': 'true', '8.1': 'true' }) },
  })
  const run = werk.start(['run', 'hx', '--cap', '1'])
  await run.exited
  const board = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; payload: { number: number; to?: string } })
  const moves = (n: number) => board.filter((e) => e.type === 'ticket.moved' && e.payload.number === n).map((e) => e.payload.to)
  expect(moves(7)).toEqual(['building', 'merging', 'done'])
  expect(moves(8)).toEqual(['building', 'merging', 'building'])
  // The main line tip is the merge of 7, the tip before 8 reached merging.
  expect(git(werk.dir, 'log', '-1', '--format=%s', 'main')).toMatch(/^werk: merge ticket 7 /)

  await page.goto(werk.url)
  await openBoard(page)
  await expect(column(page, 'building').locator('li[data-ticket="8"]')).toBeVisible()
  await ticket(page, 8).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toHaveAttribute('data-ticket', '8')
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('BOTH-FILES-RED-MARK')
})

test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  plan(werk.dir, 'check:\n\t@true\n', [7])
  const hold = join(werk.dir, '..', 'never')
  werk.scriptAgent({
    steps: [],
    // The follow-up's builder holds, so the run stays on with the follow-up open.
    roles: { ...judges(), builder: [writes('t7.txt'), writes('fix.txt', [{ waitFor: hold }])], 'heldout-author': author, 'heldout-binder': [binder({ '7.1': 'false' }), binder({ '7.1': 'true', '8.1': 'true' })] },
  })
  const run = werk.start(['run', 'hx'])
  await openBoard(page)
  await expect(column(page, 'done').locator('li[data-ticket="7"]')).toBeVisible({ timeout: 30_000 })
  expect(git(werk.dir, 'log', '--first-parent', '--format=%s', 'main')).toMatch(/werk: merge ticket 7 /)

  const badge = ticket(page, 7).locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible({ timeout: 30_000 })
  const followUp = Number(/(\d+)\s*$/.exec((await badge.textContent())!)![1])
  // The follow-up was filed in ready and names the failed step.
  const board = readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; payload: { number: number; brief?: string; steps?: string[] } })
  const planned = board.find((e) => e.type === 'ticket.planned' && e.payload.number === followUp)!
  expect(planned).toBeDefined()
  expect(board.findLast((e) => e.type === 'heldout.followup')!.payload.steps).toEqual(['7.1'])
  expect(planned.payload.brief).toContain('Given the product is installed')

  await ticket(page, 7).getByRole('link', { name: 'Ticket 7' }).click()
  const metadata = page.getByRole('complementary', { name: 'metadata' })
  await expect(metadata.getByRole('list', { name: 'follow-ups' }).locator('[data-badge="heldout"]')).toHaveText(`held-out red → ${followUp}`)
  await badge.click()
  await expect(page).toHaveURL(new RegExp(`#/board/${followUp}$`))
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(followUp))
  // Let the held builder end, so the run ends before the harness removes the project.
  writeFileSync(hold, '')
  await run.exited
})
