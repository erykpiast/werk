/** Held-out steps 87.2 and 87.4: the merge loop as the person sees it on the board. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { BoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { expect, test } from '../../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

const ticketOf = (number: number): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
})
const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees FOLLOW-STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })

type W = { dir: string }
const git = (w: W, ...args: string[]) => spawnSync('git', args, { cwd: w.dir, encoding: 'utf8' }).stdout.trim()
const board = (w: W) => join(w.dir, '.werk', 'board.jsonl')
const events = (w: W) =>
  readFileSync(board(w), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BoardEvent)

/** Puts a subtree root -> loop and the given tickets in the project, and a Makefile on main. */
function setUp(w: W, makefile: string, tickets: TicketFields[]) {
  writeFileSync(join(w.dir, 'Makefile'), makefile)
  git(w, 'add', 'Makefile')
  git(w, 'commit', '--quiet', '-m', 'Add the check')
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(w.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(
    board(w),
    tickets.map((t, i) => JSON.stringify({ type: 'ticket.planned', payload: t, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
}
function plan(w: W, t: TicketFields) {
  const seq = events(w).length + 1
  writeFileSync(board(w), readFileSync(board(w), 'utf8') + JSON.stringify({ type: 'ticket.planned', payload: t, seq, at: new Date().toISOString(), actor: 'agent' }) + '\n')
}
async function openBoard(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}

/** Green on a branch; red on the merge queue's detached tree while red.txt holds "red". */
const MERGE_RED = 'check:\n\t@if grep -qs red red.txt && ! git symbolic-ref -q HEAD >/dev/null; then echo "MERGE-RED-MARK"; exit 1; fi\n'

test('87.2 a ticket that is red on the merged tree goes back to building and the main line stays where it was', async ({ page, werk }) => {
  setUp(werk, MERGE_RED, [ticketOf(3)])
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt')], 'heldout-author': author, 'heldout-binder': [reply({ steps: [{ id: '3.1', cmd: 'true' }] })] } })
  werk.cli(['run', 'root'])
  expect(git(werk, 'log', '--format=%s', 'main')).toContain('werk: merge ticket 3')
  const tip = git(werk, 'rev-parse', 'main')

  plan(werk, ticketOf(4))
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('red.txt', 'red\n')], 'heldout-author': author, 'heldout-binder': [reply({ steps: [] })] } })
  await openBoard(page, werk.url)
  const code = await werk.start(['run', 'root', '--cap', '1']).exited
  expect(code).not.toBe(0)

  const moves = events(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === 4 ? [e.payload.to] : []))
  expect(moves.slice(-2)).toEqual(['merging', 'building'])
  await expect(column(page, 'building').locator('li[data-ticket="4"]')).toBeVisible()
  await ticket(page, 4).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toHaveAttribute('data-ticket', '4')
  // The failed check and its output.
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('MERGE-RED-MARK', { timeout: 5_000 })
  expect(git(werk, 'rev-parse', 'main')).toBe(tip)
})

test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  setUp(werk, 'check:\n\t@true\n', [ticketOf(3)])
  // The follow-up's builder works for a long time, so the run is still on it while the person looks.
  const slow: FakeReply = { steps: [{ sleep: 25_000 }, ...reply({}).steps] }
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), slow], 'heldout-author': author, 'heldout-binder': [reply({ steps: [{ id: '3.1', cmd: 'false' }] })] },
  })
  await openBoard(page, werk.url)
  werk.start(['run', 'root'])

  await expect(column(page, 'done').locator('li[data-ticket="3"]')).toBeVisible({ timeout: 30_000 })
  const badge = ticket(page, 3).locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible({ timeout: 30_000 })
  expect(git(werk, 'log', '--format=%s', 'main')).toContain('werk: merge ticket 3')

  // The follow-up was filed in ready and names the failed step.
  const all = events(werk)
  const filed = all.findIndex((e) => e.type === 'heldout.followup')
  expect(filed).toBeGreaterThanOrEqual(0)
  const followUp = (all[filed] as Extract<BoardEvent, { type: 'heldout.followup' }>).payload.number
  const then = foldBoard(all.slice(0, filed + 1)).columns.flatMap((c) => c.tickets.map((t) => ({ ...t, column: c.name })))
  expect(then.find((t) => t.number === followUp)).toMatchObject({ column: 'ready' })
  expect(then.find((t) => t.number === followUp)!.brief).toContain(STEP)
  await expect(ticket(page, followUp)).toBeVisible()
  await expect(badge).toContainText(String(followUp))

  await ticket(page, 3).getByRole('link', { name: 'Ticket 3' }).click()
  const metadata = page.getByRole('complementary', { name: 'metadata' })
  const drawerBadge = metadata.getByRole('list', { name: 'follow-ups' }).locator('[data-badge="heldout"]')
  await expect(drawerBadge).toHaveText(await badge.innerText())

  await badge.click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toHaveAttribute('data-ticket', String(followUp))
  await expect(drawer.getByRole('article', { name: 'slice' })).toContainText('FOLLOW-STEP-MARK')
})
