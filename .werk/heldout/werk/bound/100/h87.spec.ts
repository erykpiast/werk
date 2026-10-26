/** Held-out steps 87.2 and 87.4 in the browser, and 88.1: the merge loop seen on the board. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

const reply = (object: unknown) => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string, extra: object[] = []) => ({ steps: [...extra, { edit: { path, content: `${path}\n` } }, ...reply({}).steps] })
const SLOW = { steps: [{ sleep: 60_000 }, ...reply({}).steps] }
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees HO-STEP-MARK'
const judges = () => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#hcard', '#hroot'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})

const lines = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean)
const boardFile = (w: Werk) => join(w.dir, '.werk', 'board.jsonl')

/** Adds a decided subtree "hroot" > "hcard" to the map, commits a Makefile, and plans the tickets under it. */
function plan(w: Werk, numbers: number[], makefile: string) {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: w.dir, encoding: 'utf8' })
  writeFileSync(join(w.dir, 'Makefile'), makefile)
  git('add', 'Makefile')
  git('commit', '--quiet', '-m', 'Add the check')
  const log = join(w.dir, '.werk', 'log.jsonl')
  let seq = lines(log).length
  const at = '2026-10-22T00:00:00.000Z'
  const map = [
    { type: 'node.proposed', actor: 'agent', payload: { id: 'hroot', kind: 'card', title: 'Held-out root', status: 'decided', who: 'me' } },
    { type: 'node.proposed', actor: 'agent', payload: { id: 'hcard', kind: 'card', title: 'Held-out card', status: 'decided', parent: 'hroot' } },
    { type: 'node.accepted', actor: 'you', payload: { id: 'hroot' } },
    { type: 'node.accepted', actor: 'you', payload: { id: 'hcard' } },
  ]
  for (const e of map) appendFileSync(log, JSON.stringify({ seq: ++seq, at, ...e }) + '\n')
  let bseq = lines(boardFile(w)).length
  for (const n of numbers) {
    const payload = {
      number: n,
      title: `Held ticket ${n}`,
      cites: ['hcard'],
      blockedBy: [],
      stories: [],
      touches: [`held module ${n}`],
      checks: ['make check'],
      brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
      root: 'hroot',
    }
    appendFileSync(boardFile(w), JSON.stringify({ seq: ++bseq, at, actor: 'agent', type: 'ticket.planned', payload }) + '\n')
  }
  return git
}

const boardEvents = (w: Werk) => lines(boardFile(w)).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })
/** Ends the test's run and its agents, so the harness can remove the project. */
const killRuns = async (w: Werk) => {
  const pids = [
    ...boardEvents(w).flatMap((e) => (e.type === 'run.started' ? [e.payload.pid as number] : [])),
    ...w.agentRuns().map((r) => r.pid),
  ]
  for (const pid of pids) try { process.kill(pid, 'SIGKILL') } catch {}
  await new Promise((r) => setTimeout(r, 1000))
}

async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

// 87.2 Scenario: A ticket that is red on the merged tree goes back to building and the main line stays where it was
// Given a project whose main line has one ticket already merged
// And a second ticket that passes its checks alone but fails them on top of the first ticket
// When the person starts the run and the second ticket reaches merging
// Then the board moves the second ticket from merging back to building
// And the second ticket's drawer shows the failed check and its output
// And the main line tip is the same commit as before the second ticket reached merging
test('87.2 a ticket red on the merged tree goes back to building and the main line stays', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const git = plan(werk, [7, 8], 'check:\n\t@if [ -f t7.txt ] && [ -f t8.txt ]; then echo BOTH-RED-MARK; exit 1; fi\n')
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [writes('t7.txt'), writes('t8.txt', [{ sleep: 2000 }])],
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': [reply({ steps: [{ id: '7.1', cmd: 'true' }] })],
    },
  })
  await openBoard(page)
  const run = werk.start(['run', 'hroot', '--cap', '1', '--poll-every', '50'])
  await run.exited
  const moves8 = boardEvents(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === 8 ? [e.payload.to] : []))
  expect(moves8).toEqual(['building', 'merging', 'building'])
  // The first ticket merged before the second reached merging, and the main line still ends at that merge.
  const subjects = git('log', '--first-parent', '--format=%s', 'main').stdout.split('\n')
  expect(subjects[0]).toMatch(/^werk: merge ticket 7 /)
  await expect(column(page, 'building').locator('li[data-ticket="8"]')).toBeVisible()
  await ticket(page, 8).getByRole('link', { name: 'Held ticket 8' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toHaveAttribute('data-ticket', '8')
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('BOTH-RED-MARK')
})

// 87.4 Scenario: A red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket
// Given a project with a ready ticket that passes its checks
// And a held-out step that fails on the main line once that ticket is merged
// When the person starts the run and the ticket merges
// Then the ticket is in done and the main line contains its merge
// And a new follow-up ticket appears in ready, naming the failed held-out step
// And the done ticket's card shows a held-out badge
// And the person opens the done ticket's drawer and sees the same badge in its metadata
// And the person clicks the badge and the follow-up ticket opens
test('87.4 a red held-out step after a merge files a follow-up and shows a badge', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const git = plan(werk, [7], 'check:\n\t@true\n')
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      // The follow-up's builder waits, so the follow-up stays open while the person looks.
      builder: [writes('t7.txt'), SLOW],
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': [reply({ steps: [{ id: '7.1', cmd: 'false' }] })],
    },
  })
  await openBoard(page)
  werk.start(['run', 'hroot', '--poll-every', '50'])
  try {
    await expect(column(page, 'done').locator('li[data-ticket="7"]')).toBeVisible({ timeout: 60_000 })
    const badge = ticket(page, 7).locator('[data-badge="heldout"]')
    await expect(badge).toBeVisible({ timeout: 30_000 })
    expect(git('log', '--first-parent', '--format=%s', 'main').stdout).toMatch(/werk: merge ticket 7 /)
    const filed = boardEvents(werk).find((e) => e.type === 'heldout.followup' && e.payload.after === 7)!
    expect(filed.payload.steps).toEqual(['7.1'])
    const follow = filed.payload.number as number
    // The follow-up joined the board in ready (its planned event, before any move).
    const firstMove = boardEvents(werk).find((e) => e.type === 'ticket.moved' && e.payload.number === follow)
    const planned = boardEvents(werk).find((e) => e.type === 'ticket.planned' && e.payload.number === follow)!
    expect(planned).toBeDefined()
    void firstMove
    await expect(badge).toHaveText(new RegExp(`${follow}`))

    await ticket(page, 7).getByRole('link', { name: 'Held ticket 7' }).click()
    const metadata = page.getByRole('complementary', { name: 'metadata' })
    const drawerBadge = metadata.locator('[data-badge="heldout"]')
    await expect(drawerBadge).toHaveText((await badge.textContent())!)
    await drawerBadge.click()
    await expect(page).toHaveURL(new RegExp(`#/board/${follow}$`))
    const drawer = page.getByRole('region', { name: 'drawer' })
    await expect(drawer).toHaveAttribute('data-ticket', String(follow))
    // The follow-up names the failed held-out step.
    await expect(drawer).toContainText(/7\.1|HO-STEP-MARK/)
  } finally {
    await killRuns(werk)
  }
})

// 88.1 Scenario: Nothing builds before the person starts the run
// Given a plan run with three unblocked tickets on the board in ready
// When the person opens the board and waits
// Then every ticket stays in ready
// And no ticket shows in building
// When the person starts the merge loop on the plan run
// Then the tickets move to building without any other action from the person
test('88.1 nothing builds before the person starts the run', async ({ page, werk }) => {
  test.setTimeout(120_000)
  plan(werk, [7, 8, 9], 'check:\n\t@true\n')
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [SLOW], 'heldout-author': reply({ steps: [{ text: STEP }] }) } })
  await openBoard(page)
  const ready = column(page, 'ready')
  for (const n of [7, 8, 9]) await expect(ready.locator(`li[data-ticket="${n}"]`)).toBeVisible()
  // The person waits.
  await page.waitForTimeout(3000)
  for (const n of [7, 8, 9]) await expect(ready.locator(`li[data-ticket="${n}"]`)).toBeVisible()
  for (const n of [7, 8, 9]) await expect(column(page, 'building').locator(`li[data-ticket="${n}"]`)).toHaveCount(0)
  expect(boardEvents(werk).some((e) => e.type === 'ticket.moved' && [7, 8, 9].includes(e.payload.number as number))).toBe(false)
  try {
    await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of hroot' }).click()
    for (const n of [7, 8, 9]) await expect(column(page, 'building').locator(`li[data-ticket="${n}"]`)).toBeVisible({ timeout: 30_000 })
  } finally {
    await killRuns(werk)
  }
})
