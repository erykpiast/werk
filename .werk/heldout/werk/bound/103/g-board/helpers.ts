/** Shared helpers for the board held-out tests. */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { expect, type Werk } from '../../e2e/harness.ts'

export const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
export const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
export const said = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
export const result: FakeStep = { event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: 'Done.' } }

const boardFile = (dir: string) => join(dir, '.werk', 'board.jsonl')
let seq = 1000
export function appendBoard(dir: string, ...events: { type: string; payload: unknown; actor?: string }[]) {
  for (const e of events) {
    appendFileSync(boardFile(dir), JSON.stringify({ seq: seq++, at: new Date().toISOString(), actor: e.actor ?? 'agent', type: e.type, payload: e.payload }) + '\n')
  }
}
export function replaceBoard(dir: string, ...events: { type: string; payload: unknown; actor?: string }[]) {
  writeFileSync(boardFile(dir), '')
  appendBoard(dir, ...events)
}
export const boardEvents = (dir: string) =>
  readFileSync(boardFile(dir), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })

export type Fields = { number: number; title: string; touches?: string[]; checks?: string[]; blockedBy?: number[]; root?: string; cites?: string[]; brief?: string; retries?: number }
export const planned = (f: Fields) => ({
  type: 'ticket.planned',
  payload: {
    number: f.number,
    title: f.title,
    cites: f.cites ?? ['fold'],
    blockedBy: f.blockedBy ?? [],
    stories: [],
    touches: f.touches ?? [`module ${f.number}`],
    checks: f.checks ?? ['true'],
    brief: f.brief ?? `## What to build\n\n${f.title} works.\n\n## Acceptance criteria\n\n- [ ] ${f.title} works.`,
    ...(f.root !== undefined && { root: f.root }),
  },
})
export const moved = (number: number, to: string, reason?: string) => ({ type: 'ticket.moved', payload: { number, to, ...(reason && { reason }) } })

export async function openBoard(page: Page, werk: Werk) {
  await page.goto(werk.url)
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
}

const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
/** Grader, reviewers, step author and a binder that binds every step id of the given tickets to `true`. */
export function judgesAndHeldout(tickets: number[]): Record<string, FakeReply | FakeReply[]> {
  const ids = ['ac-1', 'ac-2', 'ac-3', '#fold', '#log', '#werk', '#map', '#map-hash', '#tests']
  return {
    grader: reply({ lines: ids.map((id) => ({ id, score: 4, gap: 'none' })) }),
    ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
    'heldout-author': reply({ steps: [{ text: 'Given a thing\nWhen the user acts\nThen the user sees it' }] }),
    'heldout-binder': reply({ steps: tickets.map((n) => ({ id: `${n}.1`, cmd: 'true' })) }),
  }
}

export function commitFile(werk: Werk, path: string, content: string) {
  writeFileSync(join(werk.dir, path), content)
  spawnSync('git', ['add', path], { cwd: werk.dir })
  spawnSync('git', ['commit', '--quiet', '-m', `Add ${path}`], { cwd: werk.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
export const sessionPid = (werk: Werk, n: number): number | undefined => {
  const f = join(werk.dir, '.werk', 'sessions', `${n}.json`)
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { pid: number }).pid : undefined
}
/** Kills every run process the board log names, so a detached run does not outlive the test. */
export function killRuns(werk: Werk) {
  try {
    for (const e of boardEvents(werk.dir)) {
      if (e.type === 'run.started' && typeof e.payload.pid === 'number' && e.payload.pid !== process.pid) {
        try {
          process.kill(-e.payload.pid, 'SIGKILL')
        } catch {}
        try {
          process.kill(e.payload.pid, 'SIGKILL')
        } catch {}
      }
    }
  } catch {}
}
export const branches = (werk: Werk) => spawnSync('git', ['branch', '--list', 'werk-build/*'], { cwd: werk.dir, encoding: 'utf8' }).stdout.trim()
export const numbers = (page: Page, name: string) =>
  column(page, name).locator('li[data-ticket]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))
