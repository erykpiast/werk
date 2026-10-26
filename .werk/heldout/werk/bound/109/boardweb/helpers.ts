/** Shared helpers of the boardweb binder group. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, type Werk } from '../../e2e/harness.ts'

export const ROOT = 'map'
export const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
export const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
export const numbersIn = (page: Page, name: string) =>
  column(page, name)
    .locator('li[data-ticket]')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))
export const said = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
export const result: FakeStep = { event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: 'Done.\n{}' } }

export async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

type Ev = { type: string; payload: unknown; actor?: string }
const boardFile = (w: Werk) => join(w.dir, '.werk', 'board.jsonl')

/** Replaces the board log of the test project. */
export function writeBoard(w: Werk, events: Ev[]) {
  const lines = events.map((e, i) =>
    JSON.stringify({ seq: i + 1, at: new Date(Date.UTC(2026, 9, 21, 1, i)).toISOString(), actor: e.actor ?? 'agent', type: e.type, payload: e.payload }),
  )
  writeFileSync(boardFile(w), lines.join('\n') + '\n')
}

export const boardEvents = (w: Werk) =>
  readFileSync(boardFile(w), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })
export const movesOf = (w: Werk, n: number) =>
  boardEvents(w).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [String(e.payload.to)] : []))

export type T = { number: number; title: string; touches?: string[]; blockedBy?: number[]; brief?: string; cites?: string[]; checks?: string[]; root?: string }
export const planned = (t: T): Ev => ({
  type: 'ticket.planned',
  payload: {
    number: t.number,
    title: t.title,
    cites: t.cites ?? [],
    blockedBy: t.blockedBy ?? [],
    stories: [],
    touches: t.touches ?? [`module ${t.number}`],
    checks: t.checks ?? ['make check'],
    brief: t.brief ?? `## What to build\n\n${t.title} works.\n\n## Acceptance criteria\n\n- ${t.title} works.`,
    root: t.root ?? ROOT,
  },
})
export const moved = (number: number, to: string, reason?: string): Ev => ({ type: 'ticket.moved', payload: { number, to, ...(reason && { reason }) } })

const git = (w: Werk, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd: w.dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
export const branches = (w: Werk) => git(w, 'branch', '--list', 'werk-build/*')

/** Makes the test project ready for a real merge loop: a Makefile with `check`, and .werk out of git. */
export function prepareRepo(w: Werk, makefile = 'check:\n\t@true\n') {
  writeFileSync(join(w.dir, 'Makefile'), makefile)
  writeFileSync(join(w.dir, '.gitignore'), '.werk/\n')
  git(w, 'rm', '-r', '--cached', '--quiet', '.werk')
  git(w, 'add', 'Makefile', '.gitignore')
  git(w, 'commit', '--quiet', '-m', 'binder setup')
}

const reply = (object: unknown): FakeReply => ({ steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }] })

/** The judges pass, the step author writes no step, and the builder replies are as given. */
export function scriptRun(w: Werk, builder: FakeReply | FakeReply[]) {
  w.scriptAgent({
    steps: [],
    roles: {
      builder,
      grader: reply({ lines: [{ id: 'ac-1', score: 4, gap: 'none' }] }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
      'heldout-author': reply({ steps: [] }),
      'heldout-binder': reply({ steps: [] }),
    },
  })
}

/** A builder pass that writes one file, waits as told, and ends with a result. */
export const builds = (path: string, ...wait: FakeStep[]): FakeReply => ({ steps: [said(`Building ${path}.`), { edit: { path, content: `${path}\n` } }, ...wait, result] })

export const gate = (w: Werk, name: string) => join(w.dir, '..', name)
export const open = (w: Werk, name: string) => writeFileSync(gate(w, name), '')

export function sessionPid(w: Werk, n: number): number | undefined {
  const f = join(w.dir, '.werk', 'sessions', `${n}.json`)
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { pid: number }).pid : undefined
}

export function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Ends every run and builder session the test left, so no process outlives the test. */
export function killAll(w: Werk) {
  try {
    for (const e of boardEvents(w)) if (e.type === 'run.started' && e.payload.pid !== process.pid) tryKill(Number(e.payload.pid))
    const dir = join(w.dir, '.werk', 'sessions')
    if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) tryKill(JSON.parse(readFileSync(join(dir, f), 'utf8')).pid)
  } catch {
    /* nothing to end */
  }
}
const tryKill = (pid: number) => {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* gone */
  }
}

export async function pulses(page: Page, n: number) {
  await expect(card(page, n)).toHaveAttribute('data-live', 'true')
  expect(await card(page, n).evaluate((el) => getComputedStyle(el).animationName)).toBe('pulse')
}
export async function noPulse(page: Page, n: number) {
  await expect(card(page, n)).not.toHaveAttribute('data-live', 'true')
  expect(await card(page, n).evaluate((el) => getComputedStyle(el).animationName)).not.toBe('pulse')
}
