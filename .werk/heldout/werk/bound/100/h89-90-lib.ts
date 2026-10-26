/** Shared setup for the held-out board steps of groups 89, 90 and 108. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { NewBoardEvent, TicketFields } from '../src/board/events.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'
import type { Werk } from '../e2e/harness.ts'
import { expect } from '../e2e/harness.ts'

export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
export const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
export const said = (text: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, before: FakeReply['steps'] = []): FakeReply => ({
  steps: [...before, { edit: { path, content: `${path}\n` } }, ...reply({}).steps],
})

/** The grader, the five reviewers, the step author and a green binder. */
export function judges(): Record<string, FakeReply | FakeReply[]> {
  const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
  return {
    grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
    ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
    'heldout-author': reply({ steps: [{ text: STEP }] }),
    'heldout-binder': reply({ steps: Array.from({ length: 9 }, (_, i) => ({ id: `${i + 1}.1`, cmd: 'true' })) }),
  }
}

export const ticket = (number: number, title: string, fields: Partial<TicketFields> = {}): NewBoardEvent => ({
  type: 'ticket.planned',
  payload: {
    number,
    title,
    cites: ['loop'],
    blockedBy: [],
    stories: [],
    touches: [`module ${number}`],
    checks: ['make check'],
    brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
    root: 'root',
    ...fields,
  },
})

const DEFAULT_MAKEFILE = 'check:\n\t@true\n'

/**
 * Replaces the fixture board with a plan run over the subtree "root", whose map holds "root"
 * and a decided "loop". The main line gets a Makefile with the check target. Then opens the board.
 */
export async function planRun(page: Page, werk: Werk, events: NewBoardEvent[], makefile = DEFAULT_MAKEFILE) {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8' })
  writeFileSync(join(werk.dir, 'Makefile'), makefile)
  git('add', 'Makefile')
  git('commit', '--quiet', '-m', 'Add the check')
  const dotWerk = join(werk.dir, '.werk')
  mkdirSync(join(dotWerk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(dotWerk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const all: NewBoardEvent[] = [{ type: 'tier.recorded', payload: { tier: 'feature', root: 'root' } }, ...events]
  writeFileSync(
    join(dotWerk, 'board.jsonl'),
    all.map((e, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n',
  )
  await openBoard(page)
}

export async function openBoard(page: Page) {
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

/** Appends one board event, as an agent or a process outside the browser does. */
export function appendBoard(werk: Werk, e: NewBoardEvent, actor = 'agent') {
  const path = join(werk.dir, '.werk', 'board.jsonl')
  const last = readFileSync(path, 'utf8').trim().split('\n').at(-1)
  const seq = last ? (JSON.parse(last) as { seq: number }).seq + 1 : 1
  appendFileSync(path, JSON.stringify({ seq, at: new Date().toISOString(), actor, ...e }) + '\n')
}

/** Marks a run of "root" active, with this test's own process standing in for the merge loop. */
export const activeRun = (werk: Werk, root = 'root') => appendBoard(werk, { type: 'run.started', payload: { root, pid: process.pid } })

export function boardEvents(werk: Werk): { type: string; payload: Record<string, unknown> }[] {
  return readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

/** Kills every run process the board names, except this test's own. */
export function killRuns(werk: Werk) {
  for (const e of boardEvents(werk)) {
    const pid = e.type === 'run.started' ? (e.payload.pid as number) : undefined
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  }
}

export function sessionPid(werk: Werk, n: number): number {
  return (JSON.parse(readFileSync(join(werk.dir, '.werk', 'sessions', `${n}.json`), 'utf8')) as { pid: number }).pid
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const branches = (werk: Werk) =>
  spawnSync('git', ['branch', '--list', 'werk-build/*'], { cwd: werk.dir, encoding: 'utf8' }).stdout.trim()

export const readyOrder = (page: Page) =>
  column(page, 'ready')
    .locator('li[data-ticket]')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))
