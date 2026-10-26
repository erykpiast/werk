/** Held-out steps 87.2, 87.4, 88.1: the merge loop, seen on the board in a browser. */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type Werk } from '../../e2e/harness.ts'

type Reply = { steps: unknown[]; exit?: number }
const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)

const ticketOf = (number: number) => ({
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

const reply = (object: unknown): Reply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string, content = `${path}\n`, before: unknown[] = []): Reply => ({ steps: [...before, { edit: { path, content } }, ...reply({}).steps] })
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const binder = (bindings: Record<string, string>): Reply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
const judges = (): Record<string, Reply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
const script = (werk: Werk, builder: Reply[], binders: Reply[]) =>
  werk.scriptAgent({ steps: [], roles: { ...judges(), builder, 'heldout-author': reply({ steps: [{ text: STEP }] }), 'heldout-binder': binders } } as never)

const git = (werk: Werk, ...args: string[]) => spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8' }).stdout.trim()
type Ev = { seq: number; type: string; payload: { number?: number; to?: string; after?: number; steps?: string[] } }
const boardEvents = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Ev)
const movesOf = (werk: Werk, n: number) => boardEvents(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to!] : []))

/** A plan run of the subtree "root" with the given tickets in ready, on a main line that holds a Makefile. */
async function setup(page: Page, werk: Werk, makefile: string, tickets: number[]) {
  const at = '2026-10-21T00:00:00.000Z'
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { cwd: werk.dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`)
  }
  // The map and the board are the person's local state, not part of the main line.
  run('git', ['rm', '-r', '-q', '--cached', '.werk'])
  writeFileSync(join(werk.dir, '.gitignore'), '.werk/\n')
  writeFileSync(join(werk.dir, 'Makefile'), makefile)
  writeFileSync(join(werk.dir, 'notes.txt'), 'notes\n')
  run('git', ['add', '-A'])
  run('git', ['commit', '-q', '-m', 'Add the check'])
  const map = [
    { seq: 1, at, actor: 'agent', type: 'node.proposed', payload: { id: 'root', kind: 'card', title: 'The root', status: 'decided' } },
    { seq: 2, at, actor: 'agent', type: 'node.proposed', payload: { id: 'loop', kind: 'card', title: 'The loop', status: 'decided', parent: 'root' } },
    { seq: 3, at, actor: 'you', type: 'node.accepted', payload: { id: 'loop' } },
  ]
  writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), map.map((e) => JSON.stringify(e) + '\n').join(''))
  const board = tickets.map((n, i) => ({ seq: i + 1, at, actor: 'agent', type: 'ticket.planned', payload: ticketOf(n) }))
  writeFileSync(join(werk.dir, '.werk', 'board.jsonl'), board.map((e) => JSON.stringify(e) + '\n').join(''))
  await page.goto(`${werk.url}#/board`)
  for (const n of tickets) await expect(inColumn(page, 'ready', n)).toBeVisible()
}

test('87.2 A ticket that is red on the merged tree goes back to building and the main line stays where it was', async ({ page, werk }) => {
  test.setTimeout(90_000)
  // Each file alone is green. Both files together are red.
  const makefile = 'check:\n\t@if [ -f a.txt ] && [ -f b.txt ]; then echo "BOTH-RED-MARK: a.txt and b.txt clash"; exit 1; fi\n'
  await setup(page, werk, makefile, [1, 2])
  // The first build is fast and merges first. The second builds from the same old main line, slowly.
  script(werk, [writes('a.txt'), writes('b.txt', 'b.txt\n', [{ sleep: 4000 }])], [binder({ '1.1': 'true', '2.1': 'true' })])
  const loop = werk.start(['run', 'root', '--cap', '1'])
  expect(await loop.exited).not.toBe(0)

  const events = boardEvents(werk)
  const firstDone = events.find((e) => e.type === 'ticket.moved' && e.payload.to === 'done')
  expect(firstDone).toBeDefined()
  const first = firstDone!.payload.number!
  const second = first === 1 ? 2 : 1
  const mergeOfFirst = git(werk, 'log', '--first-parent', '--format=%H %s', 'main')
    .split('\n')
    .find((l) => l.includes(`werk: merge ticket ${first} `))!
    .split(' ')[0]!

  // Then the board moves the second ticket from merging back to building
  expect(movesOf(werk, second).join(',')).toContain('merging,building')
  await expect(inColumn(page, 'building', second)).toBeVisible()
  // And the main line tip is the same commit as before the second ticket reached merging
  expect(git(werk, 'rev-parse', 'main')).toBe(mergeOfFirst)
  // And the second ticket's drawer shows the failed check and its output
  await ticket(page, second).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('BOTH-RED-MARK', { timeout: 5_000 })
})

test('87.4 A red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  test.setTimeout(90_000)
  await setup(page, werk, 'check:\n\t@true\n', [1])
  // The follow-up's build is slow, so the person can look at the board while it is open.
  script(werk, [writes('t1.txt'), writes('fix.txt', 'fix\n', [{ sleep: 40_000 }])], [binder({ '1.1': 'false' }), binder({ '1.1': 'true', '2.1': 'true' })])
  werk.start(['run', 'root'])

  // Then the ticket is in done and the main line contains its merge
  await expect(inColumn(page, 'done', 1)).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => git(werk, 'log', '--format=%s', 'main'), { timeout: 10_000 }).toContain('werk: merge ticket 1 ')
  // And a new follow-up ticket appears in ready, naming the failed held-out step
  await expect.poll(() => boardEvents(werk).find((e) => e.type === 'heldout.followup'), { timeout: 30_000 }).toBeDefined()
  const followup = boardEvents(werk).find((e) => e.type === 'heldout.followup')!
  expect(followup.payload).toMatchObject({ after: 1, steps: ['1.1'] })
  const n = followup.payload.number!
  const planned = boardEvents(werk).findIndex((e) => e.type === 'ticket.planned' && e.payload.number === n)
  const firstMove = boardEvents(werk).findIndex((e) => e.type === 'ticket.moved' && e.payload.number === n)
  expect(planned).toBeGreaterThanOrEqual(0)
  // A planned ticket joins the board in ready; it stays there until the loop moves it.
  expect(firstMove === -1 || firstMove > planned).toBe(true)
  await expect(ticket(page, n)).toBeVisible()
  // And the done ticket's card shows a held-out badge
  const badge = ticket(page, 1).locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible()
  await expect(badge).toContainText(String(n))
  // And the person opens the done ticket's drawer and sees the same badge in its metadata
  await ticket(page, 1).getByRole('link', { name: 'Ticket 1' }).click()
  const metadata = page.getByRole('complementary', { name: 'metadata' })
  const inDrawer = metadata.locator('[data-badge="heldout"]')
  await expect(inDrawer).toHaveText((await badge.textContent())!)
  // And the person clicks the badge and the follow-up ticket opens
  await inDrawer.click()
  await expect(page).toHaveURL(new RegExp(`#/board/${n}$`))
  const slice = page.getByRole('region', { name: 'drawer' }).getByRole('article', { name: 'slice' })
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(n))
  // The follow-up names the failed held-out step.
  await expect(slice).toContainText('1.1')
})

test('88.1 Nothing builds before the person starts the run', async ({ page, werk }) => {
  test.setTimeout(90_000)
  await setup(page, werk, 'check:\n\t@true\n', [1, 2, 3])
  script(werk, [writes('t1.txt', 't1\n', [{ sleep: 3000 }]), writes('t2.txt', 't2\n', [{ sleep: 3000 }]), writes('t3.txt', 't3\n', [{ sleep: 3000 }])], [
    binder({ '1.1': 'true', '2.1': 'true', '3.1': 'true' }),
  ])
  // When the person opens the board and waits
  await page.waitForTimeout(3000)
  // Then every ticket stays in ready, And no ticket shows in building
  for (const n of [1, 2, 3]) await expect(inColumn(page, 'ready', n)).toBeVisible()
  await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)
  expect(werk.agentLaunches()).toEqual([])
  // When the person starts the merge loop on the plan run
  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: 'Start the run of root' }).click()
  // Then the tickets move to building without any other action from the person
  for (const n of [1, 2, 3]) await expect(inColumn(page, 'building', n)).toBeVisible({ timeout: 15_000 })
})
