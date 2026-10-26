/** Shared setup for the held-out board tests of groups 89 and 90. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, type Werk } from '../../e2e/harness.ts'

export const ROOT = 'werk'
export const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
export const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
export const numbers = (page: Page, name: string) =>
  column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))

export const said = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
export const result = (object: unknown = {}): FakeStep => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})
export const reply = (object: unknown = {}): FakeReply => ({ steps: [result(object)] })

/** A grader that passes every line, five reviewers with no finding, and a step author that writes no step. */
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#log', '#werk'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
  'heldout-author': reply({ steps: [] }),
})

export type T = { number: number; title: string; touches?: string[]; blockedBy?: number[] }
type Extra = { type: string; payload: unknown }

const planned = (t: T) => ({
  type: 'ticket.planned',
  payload: {
    number: t.number,
    title: t.title,
    cites: ['log'],
    blockedBy: t.blockedBy ?? [],
    stories: [],
    touches: t.touches ?? [`module ${t.number}`],
    checks: ['make check'],
    brief: `## What to build\n\n${t.title} works.\n\n## Acceptance criteria\n\n- ${t.title} works.`,
    root: ROOT,
  },
})

/**
 * Gives the project a Makefile with a `check` target, committed on the main line, and replaces
 * the fixture board with these tickets. `check` is the body of the check target.
 */
export function board(werk: Werk, tickets: T[], extra: Extra[] = [], check = '\t@true') {
  writeFileSync(join(werk.dir, 'Makefile'), `check:\n${check}\n`)
  spawnSync('git', ['add', 'Makefile'], { cwd: werk.dir })
  spawnSync('git', ['commit', '--quiet', '-m', 'Add the check'], { cwd: werk.dir })
  mkdirSync(join(werk.dir, '.werk', 'plans', ROOT), { recursive: true })
  const events = [...tickets.map(planned), ...extra]
  writeFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    events.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T01:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n',
  )
}

export const boardEvents = (werk: Werk) =>
  readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; payload: { number?: number; to?: string; root?: string; pid?: number } })
export const movesOf = (werk: Werk, n: number) =>
  boardEvents(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))

export async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

/** A gate file the fake agent or a check waits for. */
export const gate = (werk: Werk, name: string) => join(werk.dir, '..', `gate-${name}`)
export const open = (path: string) => writeFileSync(path, '')

/**
 * The end of a test that started builds: it opens every gate, so no fake agent waits for ever,
 * waits a while for the runs to end, then kills the process group of each run that is left.
 */
export async function release(werk: Werk, gates: string[]) {
  for (const g of gates) if (!existsSync(g)) open(g)
  const deadline = Date.now() + 30_000
  const runs = () => {
    const ev = boardEvents(werk)
    const started = ev.filter((e) => e.type === 'run.started').map((e) => e.payload.pid!)
    const ended = new Set(ev.filter((e) => e.type === 'run.ended').map((e) => e.payload.pid!))
    return started.filter((pid) => !ended.has(pid))
  }
  while (runs().length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
  for (const pid of runs()) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
