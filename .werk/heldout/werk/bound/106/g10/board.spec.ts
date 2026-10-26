/** Held-out steps 87.1, 87.2, 87.4 and 88.1: the merge loop as the person sees it on the board. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

type Ticket = { number: number; title: string; touches: string[]; blockedBy?: number[] }

const result = (object: unknown) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } })
const reply = (object: unknown): FakeReply => ({ steps: [result(object)] })
const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, result({})] })
const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })

const git = (werk: Werk, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

type BoardLine = { type: string; payload: Record<string, unknown> }
const boardLog = (werk: Werk): BoardLine[] =>
  readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BoardLine)
const movesOf = (werk: Werk, n: number) => boardLog(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to as string] : []))

const LOG = [
  { type: 'node.proposed', payload: { id: 'root', kind: 'card', title: 'The root', status: 'decided' } },
  { type: 'node.proposed', payload: { id: 'loop', kind: 'card', title: 'The loop', status: 'decided', parent: 'root' } },
  { type: 'node.accepted', payload: { id: 'loop' } },
]

/** The project as a plan run left it: a main line with the Makefile, a decided subtree, and the tickets in ready. */
function plan(werk: Werk, makefile: string, tickets: Ticket[], extra: (string | object)[] = []) {
  git(werk, 'rm', '-r', '-q', '--cached', '.werk')
  appendFileSync(join(werk.dir, '.git', 'info', 'exclude'), '.werk/\n')
  writeFileSync(join(werk.dir, 'Makefile'), makefile)
  git(werk, 'add', '-A')
  git(werk, 'commit', '-q', '-m', 'Add the check')
  writeFileSync(
    join(werk.dir, '.werk', 'log.jsonl'),
    LOG.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  const lines = [
    ...tickets.map((t) => ({
      type: 'ticket.planned',
      payload: {
        cites: ['loop'],
        blockedBy: [],
        stories: [],
        checks: ['make check'],
        brief: `## What to build\n\nThe feature of ticket ${t.number} works.\n\n## Acceptance criteria\n\n- The feature works.`,
        root: 'root',
        ...t,
      },
    })),
    ...extra,
  ]
  writeFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    lines.map((e, i) => JSON.stringify({ ...(e as object), seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
}

const column = (page: Page, name: string) => page.locator(`section.column[data-column="${name}"]`)
const card = (page: Page, n: number) => page.locator(`li.ticket[data-ticket="${n}"]`)

test('87.1 two green tickets merge onto the main line one after the other', async ({ page, werk }) => {
  test.setTimeout(120_000)
  plan(werk, 'check:\n\t@true\n', [
    { number: 3, title: 'Ticket three', touches: ['module 3'] },
    { number: 4, title: 'Ticket four', touches: ['module 4'] },
  ])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': binder({ '3.1': 'true', '4.1': 'true' }) },
  })
  const before = git(werk, 'branch', '--format=%(refname:short)').split('\n')
  await page.goto(`${werk.url}#/board`)
  await page.getByRole('button', { name: 'Start the run of root' }).click()

  await expect(column(page, 'done').locator('li.ticket')).toHaveCount(2, { timeout: 90_000 })
  expect(movesOf(werk, 3)).toEqual(['building', 'merging', 'done'])
  expect(movesOf(werk, 4)).toEqual(['building', 'merging', 'done'])
  // The first ticket to reach done merged first on the main line.
  const doneOrder = boardLog(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.to === 'done' ? [e.payload.number as number] : []))
  const merges = git(werk, 'log', '--first-parent', '--reverse', '--format=%s', 'main')
    .split('\n')
    .flatMap((s) => (/^werk: merge ticket (\d+) /.exec(s) ? [Number(/^werk: merge ticket (\d+) /.exec(s)![1])] : []))
  expect(merges).toEqual(doneOrder)
  // No new branch besides the main line and the ticket branches.
  const after = git(werk, 'branch', '--format=%(refname:short)').split('\n')
  const added = after.filter((b) => !before.includes(b))
  expect(added.every((b) => b.startsWith('werk-build/'))).toBe(true)
  expect(added).toHaveLength(2)
  await expect(page.locator('[data-badge="heldout"]')).toHaveCount(0)
})

test('87.2 a ticket red on the merged tree goes back to building and the main line stays', async ({ page, werk }) => {
  test.setTimeout(180_000)
  // Green on a branch, and red on the merge queue's detached tree when both tickets' files are there.
  const makefile = 'check:\n\t@if [ -f a.txt ] && [ -f b.txt ] && ! git symbolic-ref -q HEAD >/dev/null; then echo "MERGE-RED-MARK"; exit 1; fi\n'
  plan(werk, makefile, [
    { number: 1, title: 'Ticket one', touches: ['module 1'] },
    { number: 2, title: 'Ticket two', touches: ['module 2'] },
  ], [
    { type: 'ticket.moved', payload: { number: 1, to: 'building' } },
    { type: 'ticket.moved', payload: { number: 1, to: 'merging' } },
    { type: 'ticket.moved', payload: { number: 1, to: 'done' } },
  ])
  // The first ticket is already merged on the main line.
  writeFileSync(join(werk.dir, 'a.txt'), 'a\n')
  git(werk, 'add', 'a.txt')
  git(werk, 'commit', '-q', '-m', 'werk: merge ticket 1 (werk-build/one)')
  const tip = git(werk, 'rev-parse', 'main')
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('b.txt')], 'heldout-author': author, 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true' }) } })

  await page.goto(`${werk.url}#/board`)
  await page.getByRole('button', { name: 'Start the run of root' }).click()
  await expect.poll(() => movesOf(werk, 2).join(','), { timeout: 60_000 }).toContain('merging,building')
  await expect(page.getByRole('button', { name: 'Start the run of root' })).toBeVisible({ timeout: 150_000 })
  await expect(card(page, 2)).toBeVisible()
  expect(git(werk, 'rev-parse', 'main')).toBe(tip)

  await card(page, 2).getByRole('link', { name: 'Ticket two' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('MERGE-RED-MARK')
})

test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  test.setTimeout(120_000)
  plan(werk, 'check:\n\t@true\n', [{ number: 3, title: 'Ticket three', touches: ['module 3'] }])
  // The follow-up's builder works for a long time, so the follow-up is not done during the test.
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [writes('t3.txt'), { steps: [{ sleep: 40_000 }, result({})] }],
      'heldout-author': author,
      'heldout-binder': binder({ '3.1': 'false' }),
    },
  })
  await page.goto(`${werk.url}#/board`)
  await page.getByRole('button', { name: 'Start the run of root' }).click()

  await expect(column(page, 'done').locator('li.ticket[data-ticket="3"]')).toBeVisible({ timeout: 90_000 })
  expect(git(werk, 'log', '--format=%s', 'main')).toMatch(/werk: merge ticket 3 /)
  // The follow-up appeared in ready, naming the failed step.
  const log = boardLog(werk)
  const filed = log.findIndex((e) => e.type === 'heldout.followup')
  expect(filed).toBeGreaterThan(-1)
  const followUp = log[filed]!.payload.number as number
  const planned = log.find((e) => e.type === 'ticket.planned' && e.payload.number === followUp)!
  expect(planned.payload.brief as string).toContain(STEP)
  expect(log.slice(0, filed + 1).some((e) => e.type === 'ticket.moved' && e.payload.number === followUp)).toBe(false)
  await expect(card(page, followUp)).toBeVisible()

  // The done ticket's card shows a held-out badge.
  const badge = card(page, 3).locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible()
  // The drawer of the done ticket shows the same badge in its metadata.
  await card(page, 3).getByRole('link', { name: 'Ticket three' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  const drawerBadge = drawer.getByRole('complementary', { name: 'metadata' }).locator('[data-badge="heldout"]')
  await expect(drawerBadge).toBeVisible()
  await expect(drawerBadge).toHaveText(await badge.innerText())
  // A click on the badge opens the follow-up ticket.
  await drawerBadge.click()
  await expect(page).toHaveURL(new RegExp(`#/board/${followUp}$`))
  await expect(drawer).toHaveAttribute('data-ticket', String(followUp))
  await expect(drawer).toContainText('STEP-MARK')
})

test('88.1 nothing builds before the person starts the run', async ({ page, werk }) => {
  test.setTimeout(90_000)
  plan(werk, 'check:\n\t@true\n', [
    { number: 1, title: 'Ticket one', touches: ['module 1'] },
    { number: 2, title: 'Ticket two', touches: ['module 2'] },
    { number: 3, title: 'Ticket three', touches: ['module 3'] },
  ])
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [{ steps: [{ sleep: 15_000 }, result({})] }], 'heldout-author': author } })
  await page.goto(`${werk.url}#/board`)
  await expect(column(page, 'ready').locator('li.ticket')).toHaveCount(3)
  // The person waits.
  await page.waitForTimeout(3000)
  await expect(column(page, 'ready').locator('li.ticket')).toHaveCount(3)
  await expect(column(page, 'building').locator('li.ticket')).toHaveCount(0)
  expect(werk.agentLaunches()).toEqual([])

  await page.getByRole('button', { name: 'Start the run of root' }).click()
  await expect(column(page, 'building').locator('li.ticket')).toHaveCount(3, { timeout: 30_000 })
  await expect(column(page, 'ready').locator('li.ticket')).toHaveCount(0)
})
