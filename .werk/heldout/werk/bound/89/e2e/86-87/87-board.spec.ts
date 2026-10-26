/**
 * Held-out browser specs for 87.1, 87.2 and 87.4. Each test turns the served fixture project into a
 * project with a decided subtree "root", a Makefile check and its own tickets, then starts the run
 * (`werk run root`) in that project the way the board's start control does, and reads the board in
 * the browser. Moves over time are read from the board fold of .werk/board.jsonl.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../../e2e/harness.ts'
import { foldBoard } from '../../../src/board/fold.ts'
import type { BoardEvent, TicketFields } from '../../../src/board/events.ts'
import type { FakeReply } from '../../../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../../../src/test/map-events.ts'

test.setTimeout(180_000)

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
const planned = (n: number) => JSON.stringify({ seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type: 'ticket.planned', payload: ticketOf(n) })

const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const binder = (b: Record<string, string>): FakeReply => reply({ steps: Object.entries(b).map(([id, cmd]) => ({ id, cmd })) })

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

/** Replaces the fixture's map and board with a decided subtree "root" and the tickets in ready, and commits the Makefile. */
function setup(werk: Werk, makefile: string, tickets: number[]) {
  const dir = werk.dir
  writeFileSync(join(dir, 'Makefile'), makefile)
  mkdirSync(join(dir, '.werk', 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(dir, '.werk', 'board.jsonl'), tickets.map(planned).join('\n') + '\n')
  // The werk state is not part of the product's tree, as in a normal project.
  git(dir, 'rm', '-r', '-q', '--cached', '.werk')
  writeFileSync(join(dir, '.gitignore'), '.werk/\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'Add the check')
}

const events = (dir: string): BoardEvent[] =>
  readFileSync(join(dir, '.werk', 'board.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BoardEvent)
const movesOf = (dir: string, n: number) => events(dir).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))

async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

/*
 * 87.1
 * Scenario: Two green tickets merge onto the main line one after the other
 * Given a project whose main line has a plan with two ready tickets for one subtree
 * And both tickets pass their checks alone and together
 * When the person starts the run
 * Then the board shows each ticket move through building, merging, and done
 * And the main line history shows the first ticket's merge before the second ticket's merge
 * And the repository has no new branch besides the main line and the ticket branches
 * And no ticket card on the board shows a held-out badge
 */
test('87.1 two green tickets merge onto the main line one after the other', async ({ page, werk }) => {
  setup(werk, 'check:\n\t@true\n', [3, 4])
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': [binder({ '3.1': 'true', '4.1': 'true' })] } })
  await openBoard(page)
  await expect(column(page, 'ready').locator('li[data-ticket]')).toHaveCount(2)

  const run = werk.start(['run', 'root', '--parallel', '1'])
  expect(await run.exited).toBe(0)

  expect(movesOf(werk.dir, 3)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(werk.dir, 4)).toEqual(['building', 'merging', 'done'])
  const merges = git(werk.dir, 'log', '--first-parent', '--reverse', '--format=%s', 'main').split('\n').filter((s) => s.startsWith('werk: merge'))
  expect(merges.map((s) => s.split(' (')[0])).toEqual(['werk: merge ticket 3', 'werk: merge ticket 4'])
  const branches = git(werk.dir, 'branch', '--format=%(refname:short)').split('\n')
  expect(branches.filter((b) => !b.startsWith('werk-build/'))).toEqual(['main'])
  expect(branches.filter((b) => b.startsWith('werk-build/'))).toHaveLength(2)

  await expect(column(page, 'done').locator('li[data-ticket="3"]')).toBeVisible()
  await expect(column(page, 'done').locator('li[data-ticket="4"]')).toBeVisible()
  await expect(page.locator('li[data-ticket] [data-badge="heldout"]')).toHaveCount(0)
})

/*
 * 87.2
 * Scenario: A ticket that is red on the merged tree goes back to building and the main line stays where it was
 * Given a project whose main line has one ticket already merged
 * And a second ticket that passes its checks alone but fails them on top of the first ticket
 * When the person starts the run and the second ticket reaches merging
 * Then the board moves the second ticket from merging back to building
 * And the second ticket's drawer shows the failed check and its output
 * And the main line tip is the same commit as before the second ticket reached merging
 */
test('87.2 a ticket red on the merged tree goes back to building and the main line stays', async ({ page, werk }) => {
  // The check is red only on the merge queue's tree (a detached HEAD) that holds the first ticket's
  // file and the second ticket's red.txt: green on the ticket's own branch, red on top of ticket 3.
  const makefile = [
    'check:',
    '\t@if test -f t3.txt && grep -qs red red.txt && ! git symbolic-ref -q HEAD >/dev/null; then echo "MERGE-RED-MARK the check output"; exit 1; fi',
    '',
  ].join('\n')
  setup(werk, makefile, [3])
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('t3.txt')], 'heldout-author': author, 'heldout-binder': [binder({ '3.1': 'true' })] } })
  werk.cli(['run', 'root'])
  expect(movesOf(werk.dir, 3)).toEqual(['building', 'merging', 'done'])

  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), planned(4) + '\n')
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('red.txt', 'red\n')], 'heldout-author': author, 'heldout-binder': [binder({ '3.1': 'true', '4.1': 'true' })] } })
  const tip = git(werk.dir, 'rev-parse', 'main')
  await openBoard(page)

  const run = werk.start(['run', 'root', '--cap', '1'])
  await run.exited
  expect(movesOf(werk.dir, 4)).toEqual(['building', 'merging', 'building'])
  expect(foldBoard(events(werk.dir)).columns.find((c) => c.tickets.some((t) => t.number === 4))?.name).toBe('building')
  expect(git(werk.dir, 'rev-parse', 'main')).toBe(tip)

  await expect(column(page, 'building').locator('li[data-ticket="4"]')).toBeVisible()
  await ticket(page, 4).getByRole('link', { name: 'Ticket 4' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toHaveAttribute('data-ticket', '4')
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('MERGE-RED-MARK')
})

/*
 * 87.4
 * Scenario: A red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket
 * Given a project with a ready ticket that passes its checks
 * And a held-out step that fails on the main line once that ticket is merged
 * When the person starts the run and the ticket merges
 * Then the ticket is in done and the main line contains its merge
 * And a new follow-up ticket appears in ready, naming the failed held-out step
 * And the done ticket's card shows a held-out badge
 * And the person opens the done ticket's drawer and sees the same badge in its metadata
 * And the person clicks the badge and the follow-up ticket opens
 */
test('87.4 a red held-out step after a merge files a follow-up and shows a badge', async ({ page, werk }) => {
  setup(werk, 'check:\n\t@true\n', [3])
  // The follow-up's builder waits, so the follow-up stays open while the person looks at the board.
  const release = join(werk.dir, '..', 'release-followup')
  const holding: FakeReply = { steps: [{ waitFor: release }, ...writes('fix.txt').steps] }
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), holding], 'heldout-author': author, 'heldout-binder': [binder({ '3.1': 'false' }), binder({ '3.1': 'true', '4.1': 'true' })] },
  })
  await openBoard(page)
  const run = werk.start(['run', 'root'])
  try {
    await expect.poll(() => events(werk.dir).some((e) => e.type === 'heldout.followup'), { timeout: 60_000 }).toBe(true)
    const all = events(werk.dir)
    const filed = all.findIndex((e) => e.type === 'heldout.followup')
    const f = all[filed] as Extract<BoardEvent, { type: 'heldout.followup' }>
    expect(f.payload.after).toBe(3)
    expect(f.payload.steps).toEqual(['3.1'])
    const follow = f.payload.number
    const atFiling = foldBoard(all.slice(0, filed + 1)).columns.flatMap((c) => c.tickets)
    expect(atFiling.find((t) => t.number === 3)?.column).toBe('done')
    const fu = atFiling.find((t) => t.number === follow)!
    expect(fu.column).toBe('ready')
    expect(fu.brief).toContain('3.1')
    expect(git(werk.dir, 'log', '--first-parent', '--format=%s', 'main')).toContain('werk: merge ticket 3')

    await expect(column(page, 'done').locator('li[data-ticket="3"]')).toBeVisible()
    const badge = ticket(page, 3).locator('[data-badge="heldout"]')
    await expect(badge).toBeVisible()
    await expect(badge).toContainText(String(follow))
    const badgeText = (await badge.textContent())!.trim()

    await ticket(page, 3).getByRole('link', { name: 'Ticket 3' }).click()
    const metadata = page.getByRole('complementary', { name: 'metadata' })
    const drawerBadge = metadata.locator('[data-badge="heldout"]')
    await expect(drawerBadge).toHaveText(badgeText)
    await drawerBadge.click()
    await expect(page).toHaveURL(new RegExp(`#/board/${follow}$`))
    await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(follow))

    await badge.click()
    await expect(page).toHaveURL(new RegExp(`#/board/${follow}$`))
  } finally {
    writeFileSync(release, '')
    await run.exited
  }
})
