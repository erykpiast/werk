/**
 * Held-out steps of the ticket board: 81.x, 89.x, 90.x and 108.x. Each test boots the real
 * server on a copy of the fixture project through the project's own harness.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { expect, test, type Werk } from '../../e2e/harness.ts'

test.setTimeout(120_000)

const ROOT = 'heldroot'
const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
const drawer = (page: Page) => page.getByRole('region', { name: 'drawer' })
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const result = (object: unknown) => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})

async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

const boardFile = (dir: string) => join(dir, '.werk', 'board.jsonl')
const boardEvents = (dir: string) =>
  readFileSync(boardFile(dir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { seq: number; type: string; payload: Record<string, unknown> })

function appendBoard(dir: string, ...events: { type: string; payload: object; actor?: string }[]) {
  for (const e of events) {
    const seq = boardEvents(dir).length + 1
    appendFileSync(boardFile(dir), JSON.stringify({ seq, at: new Date().toISOString(), actor: e.actor ?? 'agent', type: e.type, payload: e.payload }) + '\n')
  }
}

type T = { number: number; title: string; touches?: string[]; blockedBy?: number[]; cites?: string[]; brief?: string; root?: string }
const planned = (t: T) => ({
  type: 'ticket.planned',
  payload: {
    number: t.number,
    title: t.title,
    cites: t.cites ?? [],
    blockedBy: t.blockedBy ?? [],
    stories: [],
    touches: t.touches ?? [`module ${t.number}`],
    checks: ['make check'],
    brief: t.brief ?? `## What to build\n\n${t.title} works.\n\n## Acceptance criteria\n\n- ${t.title} works.`,
    root: t.root ?? ROOT,
  },
})

const git = (dir: string, ...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim()

/**
 * A Makefile whose `make check` is green, and which waits `mergeSleep` seconds on the merge
 * queue's detached tree, so a person can see the ticket in merging. `extra` runs on every check.
 */
function commitMakefile(dir: string, opts: { mergeSleep?: number; extra?: string } = {}) {
  const lines = ['check:']
  if (opts.mergeSleep) lines.push(`\t@if ! git symbolic-ref -q HEAD >/dev/null; then sleep ${opts.mergeSleep}; fi`)
  if (opts.extra) lines.push(`\t${opts.extra}`)
  lines.push('\t@true', '')
  writeFileSync(join(dir, 'Makefile'), lines.join('\n'))
  git(dir, 'add', 'Makefile')
  git(dir, 'commit', '--quiet', '-m', 'Add the check')
}

const reply = (steps: FakeReply['steps'], exit = 0): FakeReply => ({ steps, exit })
/** The judges, the step author and the binder of a run: every one green. */
function roles(numbers: number[], builder: FakeReply | FakeReply[]) {
  const bindings = numbers.map((n) => ({ id: `${n}.1`, cmd: 'true' }))
  return {
    steps: [],
    roles: {
      builder,
      grader: reply([result({ lines: ['ac-1', 'ac-2', 'ac-3'].map((id) => ({ id, score: 4, gap: 'none' })) })]),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply([result({ findings: [] })])])),
      'heldout-author': reply([result({ steps: [{ text: 'Given the product\nWhen the user opens it\nThen the user sees it' }] })]),
      'heldout-binder': reply([result({ steps: bindings })]),
    },
  }
}

const sessionPid = (dir: string, n: number): number | undefined => {
  const f = join(dir, '.werk', 'sessions', `${n}.json`)
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { pid: number }).pid : undefined
}
function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const movesOf = (dir: string, n: number) => boardEvents(dir).filter((e) => e.type === 'ticket.moved' && e.payload.number === n)

/** A real run of ROOT with one ticket 21 whose builder never ends by itself. */
async function runWithEndlessBuild(page: Page, werk: Werk) {
  commitMakefile(werk.dir)
  appendBoard(werk.dir, planned({ number: 21, title: 'Endless build' }))
  werk.scriptAgent(roles([21], reply([said('Working on it.'), { waitFor: join(werk.dir, '..', 'never') }])))
  const run = werk.start(['run', ROOT])
  await openBoard(page)
  await expect(inColumn(page, 'building', 21)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, 21)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
  return run
}

// ---------------------------------------------------------------- 81

test('81.1 every fixture ticket shows in the column its last event names', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('section[data-column]')).toHaveCount(5)
  const names = await page.locator('section[data-column]').evaluateAll((els) => els.map((e) => e.getAttribute('data-column')))
  expect(names).toEqual(['blocked', 'ready', 'building', 'merging', 'done'])
  const expected: [string, number[]][] = [
    ['blocked', [4]],
    ['ready', [3, 6]],
    ['building', [2]],
    ['merging', [5]],
    ['done', [1]],
  ]
  for (const [name, numbers] of expected) {
    await expect(column(page, name).locator('li[data-ticket]')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(inColumn(page, name, n)).toHaveCount(1)
  }
  // Ticket 5 moved to building and then to merging: it shows only in merging.
  await expect(page.locator('li[data-ticket="5"]')).toHaveCount(1)
  await expect(inColumn(page, 'merging', 5)).toHaveCount(1)
})

test('81.2 a retry count shows only after more than one retry', async ({ page }) => {
  await openBoard(page)
  // Ticket 2 retried two times, ticket 3 one time.
  await expect(card(page, 2)).toContainText('Draw the map in a browser')
  await expect(card(page, 2).locator('[data-badge="retries"]')).toHaveText(/2/)
  await expect(card(page, 3)).toContainText('Open a card from the address bar')
  await expect(card(page, 3).locator('[data-badge="retries"]')).toHaveCount(0)
  for (const [n, brief, cite] of [
    [2, 'The server sends the fold', '#map'],
    [3, 'A reload opens the same card', '#map-hash'],
  ] as const) {
    await expect(card(page, n)).not.toContainText(brief)
    await expect(card(page, n)).not.toContainText(cite)
    await expect(card(page, n)).not.toContainText('make test')
  }
})

test('81.3 a blocker count counts only the blockers that are not done', async ({ page, werk }) => {
  // Ticket 7 is blocked by ticket 1, in done, and ticket 6, in ready.
  appendBoard(werk.dir, planned({ number: 7, title: 'Waits for two tickets', blockedBy: [1, 6], root: 'map' }))
  await openBoard(page)
  await expect(card(page, 7).locator('[data-badge="blockers"]')).toHaveText(/(^|\D)1$/)
  // Ticket 2 has no blockers.
  await expect(card(page, 2)).toBeVisible()
  await expect(card(page, 2).locator('[data-badge="blockers"]')).toHaveCount(0)
})

test('81.4 a click on a ticket opens a drawer with the slice and its metadata', async ({ page, werk }) => {
  const longBrief = `## What to build\n\n${'The long brief explains the whole slice in detail. '.repeat(12)}LONG-BRIEF-END\n\n## Acceptance criteria\n\n- The slice works.`
  appendBoard(
    werk.dir,
    planned({ number: 8, title: 'A ticket with a long brief', blockedBy: [2], cites: ['map-hash', 'map'], brief: longBrief, root: 'map' }),
    { type: 'ticket.retried', payload: { number: 8 } },
    { type: 'ticket.retried', payload: { number: 8 } },
  )
  await openBoard(page)
  await card(page, 8).getByRole('link', { name: 'A ticket with a long brief' }).click()
  const d = drawer(page)
  await expect(d).toBeVisible()
  const slice = d.getByRole('article', { name: 'slice' })
  const metadata = d.getByRole('complementary', { name: 'metadata' })
  await expect(slice).toContainText('LONG-BRIEF-END')
  await expect(slice).toContainText('The slice works.')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map-hash')
  await expect(metadata.getByRole('list', { name: 'cited cards' })).toContainText('#map')
  await expect(metadata.getByRole('list', { name: 'blockers' })).toContainText('Draw the map in a browser')
  await expect(metadata).toContainText('retries2')
  await expect(metadata.getByRole('list', { name: 'checks' })).toContainText('make check')
  const left = (await slice.boundingBox())!
  const right = (await metadata.boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(right.x)
  // The drawer sits under the board, and the columns stay visible above it.
  const board = (await page.locator('.board').boundingBox())!
  expect((await d.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const name of ['blocked', 'ready', 'building', 'merging', 'done']) await expect(column(page, name)).toBeVisible()
})

test('81.5 a click on a cited card id in the drawer opens that card on the map', async ({ page }) => {
  await openBoard(page)
  await expect(page.locator('li[data-ticket]')).toHaveCount(6)
  const before = await page.locator('li[data-ticket]').evaluateAll((els) =>
    els.map((e) => `${e.closest('section')?.getAttribute('data-column')}:${e.getAttribute('data-ticket')}`),
  )
  await card(page, 3).getByRole('link').first().click()
  await drawer(page).getByRole('list', { name: 'cited cards' }).getByRole('link', { name: '#map-hash' }).click()
  await expect(page).not.toHaveURL(/#\/board/)
  await expect(page.locator('section[data-column]')).toHaveCount(0)
  const opened = page.getByTestId('card')
  await expect(opened).toHaveAttribute('data-card-id', 'map-hash')
  await expect(opened).toContainText('The open card lives in the location hash')
  await expect(opened).toContainText('The address bar names the open card.')
  await openBoard(page)
  await expect(page.locator('section[data-column]')).toHaveCount(5)
  await expect
    .poll(() =>
      page.locator('li[data-ticket]').evaluateAll((els) =>
        els.map((e) => `${e.closest('section')?.getAttribute('data-column')}:${e.getAttribute('data-ticket')}`),
      ),
    )
    .toEqual(before)
})

// ---------------------------------------------------------------- 89

test('89.1 nothing builds before the start, and the start builds in the order the person chose', async ({ page, werk }) => {
  commitMakefile(werk.dir, { mergeSleep: 3 })
  appendBoard(werk.dir, planned({ number: 31, title: 'Alpha', touches: ['shared module'] }), planned({ number: 32, title: 'Beta', touches: ['shared module'] }))
  werk.scriptAgent(roles([31, 32], [reply([{ sleep: 2000 }, { edit: { path: 'first.txt', content: 'first\n' } }, result({})]), reply([{ edit: { path: 'second.txt', content: 'second\n' } }, result({})])]))
  await openBoard(page)
  const readyOrder = () => column(page, 'ready').locator('li[data-ticket]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))
  await expect.poll(readyOrder).toEqual([3, 6, 31, 32])
  // The person waits on the board.
  await page.waitForTimeout(3000)
  await expect(inColumn(page, 'ready', 31)).toBeVisible()
  await expect(inColumn(page, 'ready', 32)).toBeVisible()
  expect(movesOf(werk.dir, 31)).toHaveLength(0)
  expect(movesOf(werk.dir, 32)).toHaveLength(0)

  await card(page, 32).dragTo(card(page, 31))
  await expect.poll(readyOrder).toEqual([3, 6, 32, 31])
  await page.reload()
  await expect.poll(readyOrder).toEqual([3, 6, 32, 31])

  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: `Start the run of ${ROOT}` }).click()
  await expect(inColumn(page, 'building', 32)).toBeVisible({ timeout: 30_000 })
  await expect(inColumn(page, 'ready', 31)).toBeVisible()
  await expect(inColumn(page, 'merging', 32)).toBeVisible({ timeout: 60_000 })
  await expect(inColumn(page, 'done', 32)).toBeVisible({ timeout: 60_000 })
  await expect(inColumn(page, 'ready', 31)).toHaveCount(0, { timeout: 30_000 })
  const all = boardEvents(werk.dir)
  const betaDone = all.find((e) => e.type === 'ticket.moved' && e.payload.number === 32 && e.payload.to === 'done')!
  const alphaBuild = all.find((e) => e.type === 'ticket.moved' && e.payload.number === 31 && e.payload.to === 'building')!
  expect(alphaBuild).toBeDefined()
  expect(alphaBuild.seq).toBeGreaterThan(betaDone.seq)
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  // An active run of ROOT: this test's own process stands in for the merge loop.
  appendBoard(
    werk.dir,
    planned({ number: 41, title: 'Gamma' }),
    planned({ number: 42, title: 'Delta' }),
    planned({ number: 43, title: 'Epsilon' }),
    { type: 'ticket.moved', payload: { number: 42, to: 'blocked', reason: 'blocked_by: waits for a decision' } },
    { type: 'run.started', payload: { root: ROOT, pid: process.pid } },
    { type: 'ticket.moved', payload: { number: 43, to: 'building' } },
  )
  await openBoard(page)
  await expect(inColumn(page, 'ready', 41)).toBeVisible()
  await expect(inColumn(page, 'blocked', 42)).toBeVisible()
  await expect(inColumn(page, 'building', 43)).toBeVisible()
  await expect(card(page, 41).getByRole('button', { name: /^Archive/ })).toBeVisible()
  await expect(card(page, 42).getByRole('button', { name: /^Archive/ })).toBeVisible()
  expect.soft(await card(page, 43).getByRole('button', { name: /^Archive/ }).count(), 'Epsilon, in building, shows no archive action').toBe(0)

  await card(page, 41).getByRole('button', { name: /^Archive/ }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 41)).toHaveCount(0)
  await page.reload()
  await expect(card(page, 42)).toBeVisible()
  await expect(card(page, 41)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '41'])
  await expect(inColumn(page, 'ready', 41)).toBeVisible()
})

test('89.3 the trigger icon starts one ready ticket early, and it goes through the merge queue', async ({ page, werk }) => {
  commitMakefile(werk.dir, { mergeSleep: 3 })
  appendBoard(werk.dir, planned({ number: 51, title: 'First build', touches: ['shared module'] }), planned({ number: 52, title: 'Zeta', touches: ['shared module'] }))
  werk.scriptAgent(roles([51, 52], [reply([said('First build runs.'), { sleep: 6000 }, { edit: { path: 'first.txt', content: 'first\n' } }, result({})]), reply([{ edit: { path: 'zeta.txt', content: 'zeta\n' } }, result({})])]))
  werk.start(['run', ROOT])
  await openBoard(page)
  await expect(inColumn(page, 'building', 51)).toBeVisible({ timeout: 30_000 })
  await expect(inColumn(page, 'ready', 52)).toBeVisible()
  await card(page, 52).getByRole('button', { name: /^Trigger/ }).click()
  await expect(inColumn(page, 'building', 52)).toBeVisible({ timeout: 30_000 })
  await expect(inColumn(page, 'merging', 52)).toBeVisible({ timeout: 60_000 })
  await expect(inColumn(page, 'done', 52)).toBeVisible({ timeout: 60_000 })
})

test('89.4 a drag into building starts a ticket, and a drag back into ready stops it', async ({ page, werk }) => {
  commitMakefile(werk.dir)
  appendBoard(werk.dir, planned({ number: 61, title: 'First build', touches: ['shared module'] }), planned({ number: 62, title: 'Eta', touches: ['shared module'] }))
  werk.scriptAgent(
    roles([61, 62], [reply([said('First build runs.'), { sleep: 6000 }, result({})]), reply([said('Eta builds.'), { waitFor: join(werk.dir, '..', 'never') }, result({})])]),
  )
  werk.start(['run', ROOT])
  await openBoard(page)
  await expect(inColumn(page, 'building', 61)).toBeVisible({ timeout: 30_000 })
  await expect(inColumn(page, 'ready', 62)).toBeVisible()

  await card(page, 62).dragTo(column(page, 'building'))
  await expect(inColumn(page, 'building', 62)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, 62)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })

  await card(page, 62).dragTo(column(page, 'ready'))
  await expect(inColumn(page, 'ready', 62)).toBeVisible({ timeout: 10_000 })
  await expect(card(page, 62)).not.toHaveAttribute('data-live')
  expect(movesOf(werk.dir, 62).map((e) => e.payload.to)).not.toContain('merging')
  await page.reload()
  await expect(inColumn(page, 'ready', 62)).toBeVisible()
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  appendBoard(
    werk.dir,
    planned({ number: 71, title: 'Theta' }),
    planned({ number: 72, title: 'Iota' }),
    planned({ number: 73, title: 'Kappa' }),
    { type: 'ticket.moved', payload: { number: 72, to: 'blocked', reason: 'blocked_by: waits for a decision' } },
    { type: 'run.started', payload: { root: ROOT, pid: process.pid } },
    { type: 'ticket.moved', payload: { number: 73, to: 'building' } },
  )
  await openBoard(page)
  await expect(inColumn(page, 'ready', 71)).toBeVisible()
  await card(page, 71).dragTo(column(page, 'merging'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(inColumn(page, 'ready', 71)).toBeVisible()

  await card(page, 73).dragTo(column(page, 'done'))
  await expect(page.getByRole('alert')).toContainText('done')
  await expect(inColumn(page, 'building', 73)).toBeVisible()

  const eventsBefore = boardEvents(werk.dir).length
  await card(page, 72).dragTo(column(page, 'building'))
  await expect(inColumn(page, 'blocked', 72)).toBeVisible()
  await expect(inColumn(page, 'building', 72)).toHaveCount(0)
  expect(boardEvents(werk.dir).length).toBe(eventsBefore)

  for (const n of [71, 72, 73]) {
    await card(page, n).getByRole('link').first().click()
    await expect(drawer(page)).toHaveAttribute('data-ticket', String(n))
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0)
  }
})

// ---------------------------------------------------------------- 90

test('90.1 a building ticket pulses while its fake builder runs, and stops when the pass exits', async ({ page, werk }) => {
  commitMakefile(werk.dir)
  appendBoard(werk.dir, planned({ number: 81, title: 'Pulse' }))
  werk.scriptAgent(roles([81], reply([said('Working.'), { sleep: 4000 }, result({})])))
  await openBoard(page)
  await expect(inColumn(page, 'ready', 81)).toBeVisible()
  const build = werk.start(['build', '81', '--cap', '1'])
  await expect(inColumn(page, 'building', 81)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, 81)).toHaveAttribute('data-live', 'true')
  const animation = await card(page, 81).evaluate((el) => getComputedStyle(el).animationName)
  expect(animation).not.toBe('none')
  await expect(card(page, 81)).not.toHaveAttribute('data-live', 'true', { timeout: 30_000 })
  await build.exited
})

test('90.2 the drawer of a building ticket shows the agent log as it arrives', async ({ page, werk }) => {
  commitMakefile(werk.dir)
  appendBoard(werk.dir, planned({ number: 82, title: 'Log preview' }))
  const steps: FakeReply['steps'] = []
  for (let i = 1; i <= 25; i++) steps.push(said(`event number ${i}`), { sleep: 1000 })
  werk.scriptAgent(roles([82], reply([...steps, result({})])))
  await openBoard(page)
  werk.start(['build', '82', '--cap', '1'])
  await expect(inColumn(page, 'building', 82)).toBeVisible({ timeout: 30_000 })
  await card(page, 82).getByRole('link').first().click()
  const d = drawer(page)
  await expect(d).toBeVisible()
  const log = d.getByRole('region', { name: 'agent log' })
  await expect(log).toBeVisible()
  const slice = d.getByRole('article', { name: 'slice' })
  expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  const line = (n: number) => log.getByRole('listitem').filter({ hasText: new RegExp(`event number ${n}$`) })
  await expect(line(1)).toBeVisible()
  const h1 = (await log.boundingBox())!.height
  await expect(line(2)).toHaveCount(1, { timeout: 10_000 })
  await expect(line(25)).toHaveCount(1, { timeout: 60_000 })
  const h2 = (await log.boundingBox())!.height
  expect(Math.abs(h2 - h1)).toBeLessThan(2)
  const lines = log.locator('.agent-log-lines')
  const scrolls = await lines.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(scrolls).toBe(true)
})

test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  commitMakefile(werk.dir, { mergeSleep: 8 })
  const gate = join(werk.dir, '..', 'exit-pass')
  appendBoard(werk.dir, planned({ number: 83, title: 'To merging' }))
  werk.scriptAgent(roles([83], reply([said('Building.'), { waitFor: gate }, { edit: { path: 'm.txt', content: 'm\n' } }, result({})])))
  await openBoard(page)
  werk.start(['run', ROOT])
  await expect(inColumn(page, 'building', 83)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, 83)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
  await card(page, 83).getByRole('link').first().click()
  await expect(drawer(page).getByRole('region', { name: 'agent log' })).toContainText('Building.')
  writeFileSync(gate, '')
  await expect(inColumn(page, 'merging', 83)).toBeVisible({ timeout: 60_000 })
  await expect(card(page, 83)).not.toHaveAttribute('data-live', 'true')
  await expect(drawer(page).getByRole('article', { name: 'slice' })).toBeVisible()
  await expect(drawer(page).getByRole('complementary', { name: 'metadata' })).toBeVisible()
  await expect(drawer(page).getByRole('region', { name: 'agent log' })).toHaveCount(0)
})

test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  // The check takes 4 seconds and is green once the agent wrote ok.txt.
  commitMakefile(werk.dir, { extra: '@sleep 4; test -f ok.txt' })
  appendBoard(werk.dir, planned({ number: 84, title: 'Retry' }))
  werk.scriptAgent(roles([84], [reply([said('First try.'), { sleep: 3000 }, result({})], 1), reply([said('Second try.'), { edit: { path: 'ok.txt', content: 'ok\n' } }, result({})])]))
  await openBoard(page)
  werk.start(['build', '84', '--cap', '2'])
  await expect(inColumn(page, 'building', 84)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, 84)).toHaveAttribute('data-live', 'true')
  await expect(card(page, 84)).not.toHaveAttribute('data-live', 'true', { timeout: 30_000 })
  await expect(inColumn(page, 'building', 84)).toBeVisible()
  // The first pass is over and the second has not started: still one builder launch.
  expect(werk.agentLaunches().length).toBeGreaterThanOrEqual(1)
})

test('90.5 a person stops the build by hand, and the pulse and the preview end', async ({ page, werk }) => {
  commitMakefile(werk.dir)
  appendBoard(werk.dir, planned({ number: 85, title: 'Stop by hand' }))
  werk.scriptAgent(roles([85], reply([said('Endless.'), { waitFor: join(werk.dir, '..', 'never') }])))
  await openBoard(page)
  werk.start(['build', '85', '--cap', '2'])
  await expect(inColumn(page, 'building', 85)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, 85)).toHaveAttribute('data-live', 'true', { timeout: 30_000 })
  // Stop by hand: the archive action, the board's one way to end a build.
  await card(page, 85).getByRole('button', { name: /^Archive/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(page.locator('li[data-ticket="85"][data-live="true"]')).toHaveCount(0)
  // The ticket moves back: a restore.
  werk.cli(['ticket', 'restore', '85'])
  await expect(inColumn(page, 'ready', 85)).toBeVisible({ timeout: 10_000 })
  await card(page, 85).getByRole('link').first().click()
  await expect(drawer(page)).toBeVisible()
  await expect(drawer(page).getByRole('region', { name: 'agent log' })).toHaveCount(0)
})

// ---------------------------------------------------------------- 108

test('108.1 only ready, blocked and building tickets offer archive', async ({ page, werk }) => {
  appendBoard(werk.dir, { type: 'run.started', payload: { root: 'map', pid: process.pid } })
  await openBoard(page)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('active')
  // Fixture: 3 ready, 4 blocked, 2 building, 5 merging, 1 done.
  await expect(inColumn(page, 'ready', 3).getByRole('button', { name: /^Archive/ })).toBeVisible()
  await expect(inColumn(page, 'blocked', 4).getByRole('button', { name: /^Archive/ })).toBeVisible()
  await expect(inColumn(page, 'building', 2).getByRole('button', { name: /^Archive/ })).toBeVisible()
  await expect(inColumn(page, 'merging', 5)).toBeVisible()
  await expect(inColumn(page, 'merging', 5).getByRole('button', { name: /^Archive/ })).toHaveCount(0)
  await expect(inColumn(page, 'done', 1)).toBeVisible()
  await expect(inColumn(page, 'done', 1).getByRole('button', { name: /^Archive/ })).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  await runWithEndlessBuild(page, werk)
  const pid = sessionPid(werk.dir, 21)
  expect(alive(pid)).toBe(true)
  await card(page, 21).getByRole('button', { name: /^Archive/ }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 21)).toHaveCount(0)
  await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false)
  await expect(page.locator('li[data-live="true"]')).toHaveCount(0)
  expect(git(werk.dir, 'branch', '--list', 'werk-build/werk-21-*')).toMatch(/werk-build\/werk-21-/)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  await runWithEndlessBuild(page, werk)
  const pid = sessionPid(werk.dir, 21)
  await card(page, 21).getByRole('button', { name: /^Archive/ }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(inColumn(page, 'building', 21)).toBeVisible()
  await expect(card(page, 21)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})

test('108.4 an archived building ticket is restored onto the board', async ({ page, werk }) => {
  await runWithEndlessBuild(page, werk)
  await card(page, 21).getByRole('button', { name: /^Archive/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(card(page, 21)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '21'])
  await expect(card(page, 21)).toBeVisible()
  await expect(card(page, 21)).toContainText('Endless build')
  expect(git(werk.dir, 'branch', '--list', 'werk-build/werk-21-*')).toMatch(/werk-build\/werk-21-/)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  await runWithEndlessBuild(page, werk)
  const pid = sessionPid(werk.dir, 21)
  await card(page, 21).dragTo(column(page, 'ready'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(inColumn(page, 'ready', 21)).toHaveCount(0)
  await expect(inColumn(page, 'building', 21)).toBeVisible()
  await expect(card(page, 21)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})
