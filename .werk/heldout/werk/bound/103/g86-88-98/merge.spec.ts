/** Held-out steps 87.1, 87.2 and 87.4: the merge loop as the person sees it on the board. */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string, pre: FakeReply['steps'] = []): FakeReply => ({ steps: [...pre, { edit: { path, content: `${path}\n` } }, ...reply({}).steps] })
const judges = {
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
}
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
const author = reply({ steps: [{ text: STEP }] })
const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })

const ticket = (number: number, extra: object = {}) => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...extra,
})

function setup(werk: Werk, makefile: string, tickets: number[]) {
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8' })
    return r.stdout.trim()
  }
  writeFileSync(join(werk.dir, 'Makefile'), makefile)
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    tickets.map((n, i) => JSON.stringify({ type: 'ticket.planned', payload: ticket(n), seq: i + 1, at: new Date().toISOString(), actor: 'agent' })).join('\n') + '\n',
  )
  git('add', '-A')
  git('commit', '--quiet', '-m', 'the check and a plan')
  const events = () =>
    readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; payload: { number?: number; to?: string } })
  const movesOf = (n: number) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
  return { git, events, movesOf }
}

const openBoard = async (page: Page, werk: Werk) => {
  await page.goto(werk.url)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
}
const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

test('87.1 two green tickets merge onto the main line one after the other', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = setup(werk, 'check:\n\t@true\n', [1, 2])
  werk.scriptAgent({ steps: [], roles: { ...judges, builder: [writes('t1.txt'), writes('t2.txt')], 'heldout-author': author, 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true' }) } })
  const branchesBefore = s.git('branch', '--format=%(refname:short)').split('\n')
  await openBoard(page, werk)
  const code = await werk.start(['run', 'root']).exited
  expect(code).toBe(0)
  expect(s.movesOf(1)).toEqual(['building', 'merging', 'done'])
  expect(s.movesOf(2)).toEqual(['building', 'merging', 'done'])
  const merges = s.git('log', '--first-parent', '--reverse', '--format=%s', 'main').split('\n').filter((l) => l.startsWith('werk: merge'))
  expect(merges).toHaveLength(2)
  const branches = s.git('branch', '--format=%(refname:short)').split('\n')
  const added = branches.filter((b) => !branchesBefore.includes(b))
  expect(added.every((b) => b.startsWith('werk-build/'))).toBe(true)
  expect(added).toHaveLength(2)
  await expect(column(page, 'done').locator('li[data-ticket]')).toHaveCount(2)
  await expect(page.locator('[data-badge="heldout"]')).toHaveCount(0)
})

test('87.2 a ticket red on the merged tree goes back to building and the main line stays where it was', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // Red when both a.txt and b.txt are there: each ticket alone is green, both together are red.
  const s = setup(werk, 'check:\n\t@if test -f a.txt && test -f b.txt; then echo "BOTH-FILES-RED"; exit 1; fi\n', [1, 2])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges, builder: [writes('a.txt'), writes('b.txt', [{ sleep: 4000 }])], 'heldout-author': author, 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true' }) },
  })
  const code = await werk.start(['run', 'root', '--cap', '1']).exited
  expect(code).not.toBe(0)
  // The builds run at the same time, so either ticket may merge first: the other is the second ticket.
  const first = s.movesOf(1).at(-1) === 'done' ? 1 : 2
  const second = first === 1 ? 2 : 1
  expect(s.movesOf(first)).toEqual(['building', 'merging', 'done'])
  expect(s.movesOf(second)).toEqual(['building', 'merging', 'building'])
  // The main line tip is the merge of the first ticket: the tip before the second reached merging.
  expect(s.git('log', '-1', '--format=%s', 'main')).toMatch(new RegExp(`^werk: merge ticket ${first}`))
  await openBoard(page, werk)
  await expect(column(page, 'building').locator(`li[data-ticket="${second}"]`)).toBeVisible()
  await card(page, second).getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('BOTH-FILES-RED', { timeout: 5000 })
})

test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const s = setup(werk, 'check:\n\t@true\n', [1])
  // The held-out step of ticket 1 is red on the first run; the follow-up's builder makes it green.
  werk.scriptAgent({
    steps: [],
    roles: { ...judges, builder: [writes('t1.txt'), { steps: [{ sleep: 60_000 }] }], 'heldout-author': author, 'heldout-binder': [binder({ '1.1': 'false' })] },
  })
  const run = werk.start(['run', 'root', '--poll-every', '50'])
  await expect.poll(() => s.events().some((e) => e.type === 'heldout.followup'), { timeout: 60_000 }).toBe(true)
  expect(s.movesOf(1)).toEqual(['building', 'merging', 'done'])
  expect(s.git('log', '--first-parent', '--format=%s', 'main')).toMatch(/werk: merge ticket 1/)
  const followup = s.events().find((e) => e.type === 'heldout.followup')!.payload as unknown as { number: number; steps: string[] }
  expect(followup.steps).toContain('1.1')
  await openBoard(page, werk)
  const fresh = card(page, followup.number)
  await expect(fresh).toBeVisible()
  // The follow-up names the failed step (its title, or its drawer).
  await fresh.getByRole('link').first().click()
  await expect(page.getByRole('region', { name: 'drawer' })).toContainText(/1\.1|STEP-MARK/)
  await openBoard(page, werk)
  await expect(card(page, 1).locator('[data-badge="heldout"]')).toBeVisible()
  await card(page, 1).getByRole('link').first().click()
  const metadata = page.getByRole('region', { name: 'drawer' }).getByRole('complementary', { name: 'metadata' })
  const badge = metadata.locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible()
  await badge.click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(followup.number))
  void run
})
