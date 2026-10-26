/** Held-out steps 108.1-108.5 and 89.1-89.5: the person's controls on the board. */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../e2e/harness.ts'

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
const result = (object: unknown) => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})
const reply = (object: unknown) => ({ steps: [result(object)] })

const BRIEF = '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.'
const planned = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'ticket.planned',
  payload: { number, title, cites: [], blockedBy: [], stories: [], touches: [`module ${number}`], checks: ['true'], brief: BRIEF, root: 'r', ...extra },
})
const moved = (number: number, to: string, reason?: string) => ({ type: 'ticket.moved', payload: { number, to, ...(reason && { reason }) } })

let dir = ''
const boardFile = () => join(dir, '.werk', 'board.jsonl')
function writeBoard(events: object[]) {
  writeFileSync(
    boardFile(),
    events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-22T00:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n',
  )
}
const boardLines = () => readFileSync(boardFile(), 'utf8').trim().split('\n')
const boardEvents = () => boardLines().map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })
const movesOf = (n: number) => boardEvents().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const sessionPid = (n: number) => (JSON.parse(readFileSync(join(dir, '.werk', 'sessions', `${n}.json`), 'utf8')) as { pid: number }).pid
const branches = () => spawnSync('git', ['branch', '--list', 'werk-build/*'], { cwd: dir, encoding: 'utf8' }).stdout.trim()

/** The judges, step author and binder of a run, so a build can go green and merge. */
const judges = {
  grader: reply({ lines: [{ id: 'ac-1', score: 4, gap: 'none' }] }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
  'heldout-author': reply({ steps: [{ text: 'Given the product\nWhen the user opens it\nThen the user sees it' }] }),
}
const binder = (ids: string[]) => reply({ steps: ids.map((id) => ({ id, cmd: 'true' })) })
const held = (gate: string, text = 'Working.') => ({ steps: [said(text), { waitFor: gate }, { edit: { path: `${text.length}-${Date.now()}.txt`, content: 'x\n' } }, result({})] })
const writes = (path: string) => ({ steps: [{ edit: { path, content: `${path}\n` } }, result({})] })

async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

test.beforeEach(async ({ werk }) => {
  dir = werk.dir
})

// A run or an agent that a test started must not outlive it.
test.afterEach(async () => {
  const sessions = join(dir, '.werk', 'sessions')
  const pids: number[] = []
  if (existsSync(sessions)) {
    for (const f of readdirSync(sessions).filter((f) => f.endsWith('.json'))) {
      try {
        pids.push((JSON.parse(readFileSync(join(sessions, f), 'utf8')) as { pid: number }).pid)
      } catch {}
    }
  }
  if (existsSync(boardFile())) {
    for (const e of boardEvents()) if (e.type === 'run.started' && e.payload.pid !== process.pid) pids.push(e.payload.pid as number)
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
})

/** An active run of plan r with one ticket that builds, held by a builder that waits for a file that never comes. */
async function buildingRun(page: Page, werk: { scriptAgent: (s: never) => void; start: (a: string[]) => unknown }) {
  writeBoard([planned(1, 'Build the feature')])
  werk.scriptAgent({ steps: [], roles: { ...judges, builder: held(join(dir, '..', 'never')) } } as never)
  werk.start(['run', 'r'])
  await openBoard(page)
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  return sessionPid(1)
}

test('108.1 only ready, blocked, and building tickets offer archive', async ({ page }) => {
  writeBoard([
    planned(1, 'Ready one'),
    planned(2, 'Blocked one'),
    planned(3, 'Building one'),
    planned(4, 'Merging one'),
    planned(5, 'Done one'),
    moved(2, 'blocked', 'blocked_by: a blocker is not in the set'),
    moved(3, 'building'),
    moved(4, 'building'),
    moved(4, 'merging'),
    moved(5, 'building'),
    moved(5, 'merging'),
    moved(5, 'done'),
    { type: 'run.started', payload: { root: 'r', pid: process.pid } },
  ])
  await openBoard(page)
  await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('the run of r is active')
  for (const [col, n] of [['ready', 1], ['blocked', 2], ['building', 3], ['merging', 4], ['done', 5]] as const) {
    await expect(inColumn(page, col, n)).toBeVisible()
  }
  for (const n of [1, 2, 3]) await expect(ticket(page, n).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(ticket(page, 4).getByRole('button', { name: /archive/i })).toHaveCount(0)
  await expect(ticket(page, 5).getByRole('button', { name: /archive/i })).toHaveCount(0)
})

test('108.2 archiving a building ticket ends its build and keeps its branch', async ({ page, werk }) => {
  const pid = await buildingRun(page, werk as never)
  expect(alive(pid)).toBe(true)
  await ticket(page, 1).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 1)).toHaveCount(0)
  await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false)
  await expect(page.locator('li[data-ticket][data-live="true"]')).toHaveCount(0)
  expect(branches()).toMatch(/werk-build\/werk-01-/)
})

test('108.3 cancelling the confirmation leaves the build running', async ({ page, werk }) => {
  const pid = await buildingRun(page, werk as never)
  await ticket(page, 1).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})

test('108.4 an archived building ticket is restored onto the board', async ({ page, werk }) => {
  await buildingRun(page, werk as never)
  await ticket(page, 1).getByRole('button', { name: /archive/i }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 1)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '1'])
  await expect(ticket(page, 1)).toBeVisible()
  await expect(ticket(page, 1).getByRole('link')).toHaveText('Build the feature')
  expect(branches()).toMatch(/werk-build\/werk-01-/)
})

test('108.5 a drag from building into ready is refused and the build goes on', async ({ page, werk }) => {
  const pid = await buildingRun(page, werk as never)
  await ticket(page, 1).dragTo(column(page, 'ready'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(inColumn(page, 'ready', 1)).toHaveCount(0)
  await expect(inColumn(page, 'building', 1)).toBeVisible()
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  expect(alive(pid)).toBe(true)
})

test('89.1 nothing builds before the start, and the start builds the tickets in the order the person chose', async ({ page, werk }) => {
  test.setTimeout(120_000)
  writeBoard([planned(1, 'Alpha', { touches: ['decision log'] }), planned(2, 'Beta', { touches: ['decision log'] })])
  const gate = join(dir, '..', 'beta-done')
  werk.scriptAgent({
    steps: [],
    roles: { ...judges, builder: [held(gate, 'Beta'), held(join(dir, '..', 'never'), 'Alpha')], 'heldout-binder': binder(['2.1']) },
  } as never)
  await openBoard(page)
  const readyOrder = () =>
    column(page, 'ready').locator('li[data-ticket]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))
  await expect.poll(readyOrder).toEqual([1, 2])
  // The person waits on the board.
  await page.waitForTimeout(3_000)
  expect(await readyOrder()).toEqual([1, 2])
  await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)

  await ticket(page, 2).dragTo(ticket(page, 1))
  await page.reload()
  await expect.poll(readyOrder).toEqual([2, 1])

  await page.getByRole('list', { name: 'plan runs' }).getByRole('button', { name: /start/i }).click()
  await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 15_000 })
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true')
  await expect(inColumn(page, 'ready', 1)).toBeVisible()

  writeFileSync(gate, '')
  await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
  expect(movesOf(2)).toEqual(['building', 'merging', 'done'])
  await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 15_000 })
  const alphaBuilt = boardEvents().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === 1 && e.payload.to === 'building')
  const betaDone = boardEvents().findIndex((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'done')
  expect(alphaBuilt).toBeGreaterThan(betaDone)
})

test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  writeBoard([
    planned(1, 'Gamma'),
    planned(2, 'Delta'),
    planned(3, 'Epsilon'),
    moved(2, 'blocked', 'blocked_by: a blocker is not in the set'),
    moved(3, 'building'),
  ])
  await openBoard(page)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  await expect(ticket(page, 1).getByRole('button', { name: /archive/i })).toBeVisible()
  await expect(ticket(page, 2).getByRole('button', { name: /archive/i })).toBeVisible()
  const epsilonArchive = await ticket(page, 3).getByRole('button', { name: /archive/i }).count()

  await ticket(page, 1).getByRole('button', { name: /archive/i }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(/restore/i)
  await dialog.getByRole('button', { name: 'Archive' }).click()
  await expect(ticket(page, 1)).toHaveCount(0)
  await page.reload()
  await expect(inColumn(page, 'ready', 1)).toHaveCount(0)
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(ticket(page, 1)).toHaveCount(0)
  werk.cli(['ticket', 'restore', '1'])
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(ticket(page, 1).getByRole('link')).toHaveText('Gamma')
  // "Epsilon shows no archive action": checked last, so the rest of the path still runs.
  expect(epsilonArchive, 'the building ticket Epsilon shows an archive action').toBe(0)
})

test('89.3 a person starts one ready ticket early with the trigger icon, and it goes through the merge queue', async ({ page, werk }) => {
  test.setTimeout(120_000)
  // The first ticket builds and holds the module that Zeta also touches, so Zeta waits in ready.
  writeBoard([planned(1, 'First', { touches: ['decision log'] }), planned(2, 'Zeta', { touches: ['decision log'] })])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges, builder: [held(join(dir, '..', 'never'), 'First'), writes('zeta.txt')], 'heldout-binder': binder(['2.1']) },
  } as never)
  werk.start(['run', 'r'])
  await openBoard(page)
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  await expect(inColumn(page, 'ready', 2)).toBeVisible()

  await ticket(page, 2).getByRole('button', { name: /trigger/i }).click()
  await expect(inColumn(page, 'building', 2)).toBeVisible()
  await expect.poll(() => movesOf(2), { timeout: 45_000 }).toContain('merging')
  await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 45_000 })
})

test('89.4 a person starts a ticket by a drag into building, then stops it by a drag back into ready', async ({ page, werk }) => {
  test.setTimeout(90_000)
  // The run is active: its first ticket builds and holds the module that Eta also touches.
  writeBoard([planned(1, 'First', { touches: ['decision log'] }), planned(2, 'Eta', { touches: ['decision log'] })])
  werk.scriptAgent({
    steps: [],
    roles: { ...judges, builder: [held(join(dir, '..', 'never'), 'First'), held(join(dir, '..', 'never2'), 'Eta')] },
  } as never)
  werk.start(['run', 'r'])
  await openBoard(page)
  await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  await expect(inColumn(page, 'ready', 2)).toBeVisible()

  await ticket(page, 2).dragTo(column(page, 'building'))
  await expect(inColumn(page, 'building', 2)).toBeVisible()
  // Its build runs: a builder session runs for Eta.
  await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })

  await ticket(page, 2).dragTo(column(page, 'ready'))
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
  await expect(ticket(page, 2)).not.toHaveAttribute('data-live')
  expect(movesOf(2)).not.toContain('merging')
  await page.reload()
  await expect(inColumn(page, 'ready', 2)).toBeVisible()
})

test('89.5 the board refuses every other manual move and has no edit control', async ({ page }) => {
  writeBoard([
    planned(1, 'Theta'),
    planned(2, 'Iota'),
    planned(3, 'Kappa'),
    moved(2, 'blocked', 'blocked_by: a blocker is not in the set'),
    moved(3, 'building'),
    { type: 'run.started', payload: { root: 'r', pid: process.pid } },
  ])
  await openBoard(page)
  await expect(inColumn(page, 'ready', 1)).toBeVisible()

  await ticket(page, 1).dragTo(column(page, 'merging'))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(inColumn(page, 'ready', 1)).toBeVisible()
  await expect(inColumn(page, 'merging', 1)).toHaveCount(0)

  await ticket(page, 3).dragTo(column(page, 'done'))
  await expect(page.getByRole('alert')).toContainText('done')
  await expect(inColumn(page, 'building', 3)).toBeVisible()
  await expect(inColumn(page, 'done', 3)).toHaveCount(0)

  const before = boardLines().length
  await ticket(page, 2).dragTo(column(page, 'building'))
  await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  await expect(inColumn(page, 'building', 2)).toHaveCount(0)
  expect(boardLines().length).toBe(before)

  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('[contenteditable]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0)
  for (const n of [1, 2, 3]) {
    await ticket(page, n).getByRole('link').click()
    await expect(page.getByRole('region', { name: 'drawer' }).getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0)
  }
})
